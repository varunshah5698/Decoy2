import type { ReactNode } from 'react'

const structural = (line: string) =>
  /^\s*([-*•]\s+|\d+[.)]\s+|#{1,4}\s+|>\s?|```|\*{3,}|-{3,})/.test(line)

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g
  let cursor = 0
  let match: RegExpExecArray | null
  let i = 0

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    const token = match[0]
    const key = `${keyPrefix}-${i++}`
    if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token)
      if (link) {
        nodes.push(
          <a key={key} href={link[2]} target="_blank" rel="noreferrer noopener">
            {link[1]}
          </a>,
        )
      } else {
        nodes.push(token)
      }
    }
    cursor = match.index + token.length
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

export function AiMarkdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      i += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      const code: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i])
        i += 1
      }
      i += 1
      blocks.push(
        <pre key={`b${key++}`} className="ai-md-pre">
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (heading) {
      blocks.push(
        <div key={`b${key++}`} className={`ai-md-h ai-md-h${heading[1].length}`}>
          {inline(heading[2], `h${key}`)}
        </div>,
      )
      i += 1
      continue
    }

    if (/^[-*•]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ''))
        i += 1
      }
      blocks.push(
        <ul key={`b${key++}`} className="ai-md-list">
          {items.map((item, n) => (
            <li key={n}>{inline(item, `li${key}-${n}`)}</li>
          ))}
        </ul>,
      )
      continue
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''))
        i += 1
      }
      blocks.push(
        <ol key={`b${key++}`} className="ai-md-list ai-md-ordered">
          {items.map((item, n) => (
            <li key={n}>{inline(item, `ol${key}-${n}`)}</li>
          ))}
        </ol>,
      )
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''))
        i += 1
      }
      blocks.push(
        <blockquote key={`b${key++}`} className="ai-md-quote">
          {inline(quote.join(' '), `q${key}`)}
        </blockquote>,
      )
      continue
    }

    if (/^-{3,}$/.test(trimmed)) {
      blocks.push(<hr key={`b${key++}`} className="ai-md-rule" />)
      i += 1
      continue
    }

    const paragraph: string[] = []
    while (i < lines.length && lines[i].trim() && !structural(lines[i])) {
      paragraph.push(lines[i].trim())
      i += 1
    }
    if (!paragraph.length) {
      paragraph.push(trimmed)
      i += 1
    }
    blocks.push(
      <p key={`b${key++}`} className="ai-md-p">
        {inline(paragraph.join(' '), `p${key}`)}
      </p>,
    )
  }

  return <div className={className ? `ai-md ${className}` : 'ai-md'}>{blocks}</div>
}
