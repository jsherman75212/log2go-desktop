import type { ReactNode } from 'react';

// ── BB Code Parser ───────────────────────────────────────────────────
// Parses NetLogger-style BB codes: [b], [i], [u], [s], [big], [small], [p]
// and converts to React spans with CSS classes.

const BB_TAGS: Record<string, string> = {
  b: 'aim-msg-bb-bold',
  i: 'aim-msg-bb-italic',
  u: 'aim-msg-bb-underline',
  s: 'aim-msg-bb-strike',
  big: 'aim-msg-bb-big',
  small: 'aim-msg-bb-small',
  p: 'aim-msg-bb-paragraph',
};

type BBNode =
  | { type: 'text'; content: string }
  | { type: 'tag'; tag: string; children: BBNode[] };

function parseBBCode(text: string): BBNode[] {
  const nodes: BBNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Find next opening tag
    const openMatch = remaining.match(/\[(b|i|u|s|big|small|p)\]/i);
    if (!openMatch || openMatch.index === undefined) {
      nodes.push({ type: 'text', content: remaining });
      break;
    }

    // Text before the tag
    if (openMatch.index > 0) {
      nodes.push({ type: 'text', content: remaining.slice(0, openMatch.index) });
    }

    const tag = openMatch[1].toLowerCase();
    const closeTag = `[/${tag}]`;
    const afterOpen = remaining.slice(openMatch.index + openMatch[0].length);
    const closeIdx = afterOpen.toLowerCase().indexOf(closeTag.toLowerCase());

    if (closeIdx === -1) {
      // No closing tag — treat as plain text
      nodes.push({ type: 'text', content: remaining.slice(openMatch.index) });
      break;
    }

    const innerContent = afterOpen.slice(0, closeIdx);
    nodes.push({
      type: 'tag',
      tag,
      children: parseBBCode(innerContent), // recursive for nesting
    });

    remaining = afterOpen.slice(closeIdx + closeTag.length);
  }

  return nodes;
}

// ── Emoticons ────────────────────────────────────────────────────────

const EMOTICONS: Record<string, string> = {
  ':)': '😊',
  ':(': '😢',
  ':D': '😀',
  ':p': '😛',
  ':|': '😐',
  ';)': '😉',
  '8)': '😎',
  ':B': '😁',
};

function replaceEmoticons(text: string): string {
  let result = text;
  // Sort by length descending to avoid partial matches
  const sortedKeys = Object.keys(EMOTICONS).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    // Use a global regex, escaping special chars
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'g'), EMOTICONS[key]);
  }
  return result;
}

// ── URL Linkifier ────────────────────────────────────────────────────

function linkifyUrls(text: string): ReactNode[] {
  const urlRegex = /(https?:\/\/[^\s<]+)/gi;
  const parts = text.split(urlRegex);
  return parts.map((part, i) => {
    if (urlRegex.test(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ color: '#00b4ff', textDecoration: 'underline' }}>
          {part}
        </a>
      );
    }
    return part;
  });
}

// ── Render BB nodes to React ─────────────────────────────────────────

function renderBBNodes(nodes: BBNode[], keyPrefix = ''): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    if (node.type === 'text') {
      const withEmoticons = replaceEmoticons(node.content);
      return <span key={key}>{linkifyUrls(withEmoticons)}</span>;
    }
    const className = BB_TAGS[node.tag];
    return (
      <span key={key} className={className}>
        {renderBBNodes(node.children, key)}
      </span>
    );
  });
}

// ── Main export: render AIM message text ─────────────────────────────

export function renderAimText(text: string): ReactNode {
  const nodes = parseBBCode(text);
  return <>{renderBBNodes(nodes)}</>;
}

// ── AIM message role classification ──────────────────────────────────

export type AimMessageRole = 'default' | 'ncs' | 'own' | 'status' | 'ignored';

export function getAimMessageClass(
  senderCallsign: string | undefined,
  myCallsign: string | undefined,
  isNcsSender: boolean,
  isStatusMessage: boolean,
  isIgnored: boolean,
): string {
  if (isIgnored) return 'aim-msg-ignored';
  if (isStatusMessage) return 'aim-msg-status';
  if (isNcsSender) return 'aim-msg-ncs';
  if (myCallsign && senderCallsign && senderCallsign.trim().toUpperCase() === myCallsign.trim().toUpperCase()) {
    return 'aim-msg-own';
  }
  return 'aim-msg-default';
}