#ifndef HELPOS_OBSERVER_H
#define HELPOS_OBSERVER_H

// Invoke from a worker thread. The UTF-8 JSON result is owned by the caller.
// Commands: --probe, --facetime-call, --observe <allowlisted bundle identifier>.
char *helpos_observe(const char *command);
void helpos_free(void *pointer);

#endif
