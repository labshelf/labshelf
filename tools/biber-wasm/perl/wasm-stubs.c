/* Provides libc functions that emscripten declares but does not implement, so the static perl links. */
#include <errno.h>
#include <signal.h>

/* No signal is ever delivered in the wasm runtime, so waiting for one can only fail. */
int sigsuspend(const sigset_t *mask) {
  (void)mask;
  errno = ENOSYS;
  return -1;
}
