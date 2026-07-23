/**
 * Simple, dependency-free XML parser for NetLogger API responses.
 *
 * Uses regex-based extraction of elements and text content.
 * This avoids needing DOMParser in Node.js test environments.
 * In React Native, DOMParser is available natively.
 *
 * The parser handles the specific XML structure used by the NetLogger API
 * — it is NOT a general-purpose XML parser.
 */

export type XmlNode = {
  tagName: string;
  children: XmlNode[];
  textContent: string;
};

/**
 * Parse XML string into a tree of XmlNode objects.
 * Handles the simple, well-structured XML used by NetLogger API responses.
 */
export function parseXmlToTree(xml: string): XmlNode {
  // Remove XML declaration
  const cleanXml = xml.replace(/<\?xml[^?]*\?>/g, '').trim();

  function parseElement(tagName: string, content: string): XmlNode {
    const children: XmlNode[] = [];
    let textContent = '';

    // Extract text content (before any child elements)
    const textMatch = content.match(/^([^<]*)/);
    if (textMatch) {
      textContent = textMatch[1].trim();
    }

    // Find all direct child elements
    const childPattern = /<(\w+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
    let match: RegExpExecArray | null;

    while ((match = childPattern.exec(content)) !== null) {
      const childTagName = match[1];
      const childContent = match[2];
      children.push(parseElement(childTagName, childContent));
    }

    // If no child elements found, the entire content is text
    if (children.length === 0 && textContent === '') {
      textContent = content.trim();
    }

    return { tagName, children, textContent };
  }

  // Match the root element
  const rootMatch = cleanXml.match(/<(\w+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/);
  if (!rootMatch) {
    throw new Error('No root element found in XML');
  }

  return parseElement(rootMatch[1], rootMatch[2]);
}

/**
 * Get the text content of a child element by tag name.
 * Handles duplicate tag names by returning the first match.
 */
export function getChildText(node: XmlNode, tagName: string): string {
  const child = node.children.find((c) => c.tagName === tagName);
  if (!child) return '';
  // If the child has sub-children, concatenate their text
  if (child.children.length > 0) {
    return child.children.map((c) => c.textContent).join(' ').trim();
  }
  return child.textContent;
}

/**
 * Get all direct children with the given tag name.
 */
export function getChildren(node: XmlNode, tagName: string): XmlNode[] {
  return node.children.filter((c) => c.tagName === tagName);
}

/**
 * Get a single child by tag name. Returns undefined if not found.
 */
export function getChild(node: XmlNode, tagName: string): XmlNode | undefined {
  return node.children.find((c) => c.tagName === tagName);
}