function escapeMarkup(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function wrapUntrusted(source: string, text: string): string {
  // Escape delimiters in the data too, so it cannot close the trusted wrapper.
  return `<untrusted-data source="${escapeMarkup(source)}">\n${escapeMarkup(text)}\n</untrusted-data>`;
}
