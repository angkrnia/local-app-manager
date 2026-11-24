import { stripAnsi } from './ansi'

const MAX_BUFFERED_LINE = 64 * 1024

/**
 * Incrementally splits child process output into lines. Handles \n, \r\n and
 * carriage-return progress updates, and caps pathological unterminated lines.
 */
export class LineSplitter {
  private buffer = ''

  push(chunk: string): string[] {
    this.buffer += stripAnsi(chunk)
    const lines: string[] = []
    let newlineIndex = this.buffer.indexOf('\n')

    while (newlineIndex !== -1) {
      let line = this.buffer.slice(0, newlineIndex)
      this.buffer = this.buffer.slice(newlineIndex + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (line.length > 0) lines.push(line)
      newlineIndex = this.buffer.indexOf('\n')
    }

    // A bare \r signals a progress redraw; surface the current content.
    const carriageIndex = this.buffer.lastIndexOf('\r')
    if (carriageIndex !== -1) {
      const line = this.buffer.slice(0, carriageIndex).trimEnd()
      this.buffer = this.buffer.slice(carriageIndex + 1)
      if (line.length > 0) lines.push(line)
    }

    if (this.buffer.length > MAX_BUFFERED_LINE) {
      lines.push(this.buffer)
      this.buffer = ''
    }

    return lines
  }

  flush(): string[] {
    const remainder = this.buffer.trimEnd()
    this.buffer = ''
    return remainder.length > 0 ? [remainder] : []
  }
}
