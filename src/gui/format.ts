const markupEntities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeMarkup(text: string): string {
	return text.replace(/[&<>"']/g, character => markupEntities[character]);
}
