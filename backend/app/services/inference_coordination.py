"""Small process-wide coordination primitives for shared CUDA execution."""

from __future__ import annotations

import itertools
import threading
import time
from contextlib import contextmanager


# Multiple independent Ultralytics predictors launching from Python threads can
# contend on the same CUDA context and produce long latency spikes even when
# average GPU utilization is low. Temporal behavior gets batching; PPE preview
# is latest-only, so serializing the short CUDA launch sections is preferable
# to unpredictable concurrent launches.
class PriorityInferenceLock:
    """A re-entrant priority lock with deadlines that prevent starvation."""

    _MAX_WAIT_SECONDS = {1: 0.040, 2: 0.500}
    # Ceiling on how long a parked waiter may sleep before it re-runs
    # _next_waiter(). Every transition that can change the designated winner
    # already wakes the waiters explicitly, so this only ever costs a few
    # wakeups per second on an otherwise idle lock — it is here so that a
    # missed wake degrades into a one-tick delay instead of a permanent
    # freeze of every GPU consumer in the process.
    _MAX_PARK_SECONDS = 0.050

    def __init__(self) -> None:
        self._condition = threading.Condition()
        self._waiters: list[tuple[int, int, int, float]] = []
        self._counter = itertools.count()
        self._owner: int | None = None
        self._depth = 0

    def acquire(self, priority: int = 1) -> None:
        thread_id = threading.get_ident()
        with self._condition:
            if self._owner == thread_id:
                self._depth += 1
                return
            ticket = (priority, next(self._counter), thread_id, time.monotonic())
            self._waiters.append(ticket)
            # A new ticket can displace whoever _next_waiter() designated a
            # moment ago, and that thread is already parked. Waking on every
            # change to the waiter set — rather than reasoning case by case
            # about which changes can matter — is what keeps the invariant
            # below true: a thread only stays parked while some *other*
            # thread is designated and still able to run.
            self._condition.notify_all()
            while self._owner is not None or self._next_waiter() != ticket:
                self._condition.wait(self._recheck_delay())
            self._waiters.remove(ticket)
            self._owner = thread_id
            self._depth = 1

    def _recheck_delay(self) -> float:
        """How long this waiter may park before _next_waiter() must be re-run.

        _next_waiter() is a function of the clock, not just of the waiter set:
        a ticket joins `overdue` the moment its deadline passes, which can
        hand the lock to a different waiter with no state change and so no
        notify_all() from anyone. Waiters re-check only when notified, so the
        new designee could sleep through its own turn — and since notify_all()
        fires only from release(), an idle lock never woke it again. That
        deadlocked every GPU consumer at once: PPE, sign, and behavior all
        parked here with the lock unowned, leaving the annotated stream
        publishing raw frames with no detections on them.

        Waking at the next deadline (capped) makes each deadline transition
        re-evaluated by the threads it affects.
        """
        now = time.monotonic()
        delay = self._MAX_PARK_SECONDS
        for waiter in self._waiters:
            budget = self._MAX_WAIT_SECONDS.get(waiter[0])
            if budget is None:
                continue
            remaining = waiter[3] + budget - now
            if 0.0 < remaining < delay:
                delay = remaining
        # Never return 0: Condition.wait(0) spins without releasing the GIL
        # long enough for the designated thread to make progress.
        return max(delay, 0.001)

    def _next_waiter(self) -> tuple[int, int, int, float]:
        now = time.monotonic()
        overdue = [
            waiter
            for waiter in self._waiters
            if waiter[0] in self._MAX_WAIT_SECONDS
            and now - waiter[3] >= self._MAX_WAIT_SECONDS[waiter[0]]
        ]
        if overdue:
            return min(
                overdue,
                key=lambda waiter: (
                    waiter[3] + self._MAX_WAIT_SECONDS[waiter[0]],
                    waiter[1],
                ),
            )
        return min(self._waiters, key=lambda waiter: (waiter[0], waiter[1]))

    def release(self) -> None:
        thread_id = threading.get_ident()
        with self._condition:
            if self._owner != thread_id:
                raise RuntimeError("GPU inference lock released by a non-owner thread")
            self._depth -= 1
            if self._depth == 0:
                self._owner = None
                self._condition.notify_all()

    def __enter__(self) -> "PriorityInferenceLock":
        self.acquire()
        return self

    def __exit__(self, *_args) -> None:
        self.release()

    @contextmanager
    def priority(self, value: int):
        self.acquire(value)
        try:
            yield self
        finally:
            self.release()


@contextmanager
def inference_priority(lock, priority: int):
    """Use priority support when available and preserve simple test locks."""
    priority_context = getattr(lock, "priority", None)
    with priority_context(priority) if callable(priority_context) else lock:
        yield


gpu_inference_lock = PriorityInferenceLock()
