const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '')
}

/** Removes carriage-return based progress redraws while keeping the final state. */
export function normalizeCarriageReturns(value: string): string {
  if (!value.includes('\r')) return value
  return value
    .split('\n')
    .map((line) => {
      const parts = line.split('\r').filter((part) => part.length > 0)
      return parts.length > 0 ? parts[parts.length - 1] : ''
    })
    .join('\n')
}
