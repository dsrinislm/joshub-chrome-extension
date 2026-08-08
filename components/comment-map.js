function createCommentMap(storageKey) {
  async function readMap() {
    const data = await chrome.storage.local.get(storageKey);
    return data[storageKey] || {};
  }

  function writeMap(map) {
    return chrome.storage.local.set({ [storageKey]: map });
  }

  return {
    async getMappedIds(sourceId) {
      const map = await readMap();
      const entry = map[String(sourceId)];
      return entry ? new Set(Object.keys(entry)) : new Set();
    },

    async isEntryFrom(sourceId, entryId) {
      if (!sourceId || !entryId) return false;
      const map = await readMap();
      const entry = map[String(sourceId)];
      if (!entry) return false;
      return Object.values(entry).includes(String(entryId));
    },

    async addMappings(sourceId, pairs, entryIdKey) {
      if (!sourceId || !Array.isArray(pairs) || !pairs.length) return;
      const map = await readMap();
      if (!map[String(sourceId)]) map[String(sourceId)] = {};
      for (const pair of pairs) {
        const jiraCommentId = pair?.jiraCommentId;
        const entryId = pair?.[entryIdKey];
        if (jiraCommentId && entryId) {
          map[String(sourceId)][String(jiraCommentId)] = String(entryId);
        }
      }
      await writeMap(map);
    },
  };
}

const sparkCommentMap = createCommentMap("jiraSparkCommentMap");
const octaneCommentMap = createCommentMap("jiraOctaneCommentMap");

export const getMappedJiraCommentIds = (sparkSysId) =>
  sparkCommentMap.getMappedIds(sparkSysId);

export const isEntryFromJira = (sparkSysId, sparkEntrySysId) =>
  sparkCommentMap.isEntryFrom(sparkSysId, sparkEntrySysId);

export const addCommentMappings = (sparkSysId, pairs) =>
  sparkCommentMap.addMappings(sparkSysId, pairs, "sparkEntrySysId");

export const getMappedOctaneCommentIds = (workItemId) =>
  octaneCommentMap.getMappedIds(workItemId);

export const isEntryFromJiraOctane = (workItemId, octaneCommentId) =>
  octaneCommentMap.isEntryFrom(workItemId, octaneCommentId);

export const addOctaneCommentMappings = (workItemId, pairs) =>
  octaneCommentMap.addMappings(workItemId, pairs, "octaneCommentId");
