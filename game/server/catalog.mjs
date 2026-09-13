// Publication is an explicit package property, not inferred from its location.
// The development override is opt-in and must stay off for public previews.
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;

export function isAvailableStory(data, includeDevStories = false) {
  if (!data || typeof data !== 'object' || !nonempty(data.story?.id)) return false;
  if (includeDevStories) return true;
  const source = data.source;
  return source?.kind === 'zhihu-hackathon'
    && nonempty(source.workId)
    && nonempty(source.title)
    // An explicit missing-credit status is truthful; never manufacture an author
    // just to satisfy the preview gate. Blank authors without that status fail.
    && (nonempty(source.author) || (source.author === '' && source.authorStatus === 'not_provided'))
    && data.release?.status === 'preview';
}

export function storyMeta(data) {
  return {
    id: data.story.id,
    title: data.story.title || data.story.id,
    author: data.story.author || '',
    tags: Array.isArray(data.story.tags) ? data.story.tags : [],
    start: data.start || null,
    sceneCount: Array.isArray(data.scenes) ? data.scenes.length : 0,
    endingCount: Array.isArray(data.endings) ? data.endings.length : 0,
    intro: data.kanshan?.intro || '',
    source: data.source || null,
    release: data.release || null,
  };
}

export function clientStory(data) {
  // Keep only what the chat UI needs. Full NPC cards and lore stay at the gateway.
  // Rules and endings intentionally remain in this local preview client: this is
  // prompt/spoiler minimization, not an anti-cheat or server-authoritative game.
  return {
    ...data,
    npcs: (Array.isArray(data.npcs) ? data.npcs : []).map((npc) => ({
      id: npc.id,
      name: npc.name,
      card: { first_mes: npc.card?.first_mes || '' },
    })),
    lore: (Array.isArray(data.lore) ? data.lore : []).map((entry) => ({ id: entry.id })),
  };
}
