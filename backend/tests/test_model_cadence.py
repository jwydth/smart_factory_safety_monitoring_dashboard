import threading
import time

from app.services.inference_coordination import PriorityInferenceLock
from app.services.model_cadence import CadenceGate, ModelCadence


def test_model_cadences_for_24_fps_source():
    ppe = ModelCadence(24, 8)
    sign = ModelCadence(24, 1, phase=13)

    assert [index for index in range(24) if ppe.is_due(index)] == list(range(0, 24, 3))
    assert [index for index in range(48) if sign.is_due(index)] == [13, 37]
    assert not ppe.is_due(13)


def test_cadence_gate_uses_first_frame_after_a_missed_deadline():
    gate = CadenceGate(ModelCadence(24, 8))

    accepted = [index for index in (100, 101, 102, 105, 106, 108, 109) if gate.accept(index)]

    assert accepted == [100, 105, 108]


def test_priority_lock_admits_behavior_before_waiting_sign():
    lock = PriorityInferenceLock()
    order: list[str] = []
    ready = threading.Barrier(3)

    lock.acquire()

    def contender(name: str, priority: int):
        ready.wait()
        with lock.priority(priority):
            order.append(name)

    sign = threading.Thread(target=contender, args=("sign", 2))
    behavior = threading.Thread(target=contender, args=("behavior", 0))
    sign.start()
    behavior.start()
    ready.wait()
    time.sleep(0.01)
    lock.release()
    sign.join()
    behavior.join()

    assert order == ["behavior", "sign"]


def test_priority_lock_deadline_prevents_ppe_starvation(monkeypatch):
    lock = PriorityInferenceLock()
    lock._MAX_WAIT_SECONDS = {1: 0.01, 2: 1.0}
    order: list[str] = []
    lock.acquire()

    def contender(name: str, priority: int):
        with lock.priority(priority):
            order.append(name)

    ppe = threading.Thread(target=contender, args=("ppe", 1))
    ppe.start()
    time.sleep(0.02)
    behavior = threading.Thread(target=contender, args=("behavior", 0))
    behavior.start()
    time.sleep(0.01)
    lock.release()
    ppe.join()
    behavior.join()

    assert order == ["ppe", "behavior"]


def test_priority_lock_recovers_when_the_designated_waiter_changes_while_parked():
    """A parked waiter must re-check once its own deadline makes it the winner.

    _next_waiter() is a function of the clock, not only of the waiter set, so
    the ticket it designates can change with no state change and therefore no
    notify from anyone. Waking the contenders one at a time — the way the
    scheduler separates them under load — with the sign ticket's deadline
    elapsing in between leaves the new designee asleep: sign re-checks first
    and defers to behavior, then behavior re-checks after sign has gone overdue
    and defers to sign. Since notify_all() fires only from release(), an
    unowned lock never woke either of them again, and PPE, sign, and behavior
    all froze together while the annotated stream went on publishing frames
    with no detections drawn on them.
    """
    lock = PriorityInferenceLock()
    lock._MAX_WAIT_SECONDS = {1: 0.01, 2: 0.20}
    finished: list[str] = []

    def contender(name: str, priority: int):
        with lock.priority(priority):
            finished.append(name)

    lock.acquire(1)
    # Daemon threads: a regression parks both of these forever, and a
    # non-daemon pair would then hang interpreter shutdown after the assert
    # below had already reported the failure.
    sign = threading.Thread(target=contender, args=("sign", 2), daemon=True)
    sign.start()
    time.sleep(0.05)
    behavior = threading.Thread(target=contender, args=("behavior", 0), daemon=True)
    behavior.start()
    time.sleep(0.05)

    with lock._condition:
        lock._owner = None
        lock._depth = 0
        lock._condition.notify(1)  # sign re-checks: behavior is designated
    time.sleep(0.25)               # sign's 0.20s deadline passes while it sleeps
    with lock._condition:
        lock._condition.notify(1)  # behavior re-checks: sign is designated

    sign.join(timeout=2.0)
    behavior.join(timeout=2.0)

    assert sorted(finished) == ["behavior", "sign"]
    assert lock._owner is None
    assert lock._waiters == []
