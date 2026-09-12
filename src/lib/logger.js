// Minimal structured logger: one JSON line per call, to stdout/stderr.
// No external dependency (pino/winston would be overkill at this size),
// but the shape — timestamp, level, service, message, structured context —
// mirrors what those libraries give you, so swapping one in later is a
// config change, not a rewrite.
//
// Deliberate rule: callers pass structured `context` fields (domain,
// status, durationMs, etc.), never raw secrets. There's no redaction logic
// here on purpose — the contract is "don't put secrets in context" at the
// call site, same as you'd expect from any real logging setup.

export function createLogger(service) {
  function write(level, message, context = {}) {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service,
      message,
      ...context,
    });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  return {
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
  };
}
