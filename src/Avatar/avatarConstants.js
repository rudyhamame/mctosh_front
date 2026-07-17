// Shared vocabulary for the avatar-provider layer (see AvatarProviderContext.jsx
// and AvatarContainer.jsx) — plain JS, not TypeScript (this repo has no
// .ts/.tsx files anywhere), so the "types" below are JSDoc typedefs purely
// for editor hinting, with the actual runtime values living in plain objects.

export const AVATAR_PROVIDERS = {
  ANAM: "anam",
  LOCAL3D: "local3d",
};

export const AVATAR_PROVIDER_LIST = [
  { id: AVATAR_PROVIDERS.ANAM, label: "ANAM", sub: "Cloud realistic avatar" },
  { id: AVATAR_PROVIDERS.LOCAL3D, label: "Local 3D", sub: "Lower-cost browser avatar" },
];

/**
 * One turn's worth of speech for an avatar provider to act on.
 * @typedef {Object} AvatarSpeechInput
 * @property {string} text
 * @property {string} [language]
 * @property {string} [expression]
 * @property {string} [audioUrl]
 * @property {Array<{time: number, viseme: string}>} [visemes]
 */

/**
 * @typedef {"idle"|"initializing"|"ready"|"speaking"|"paused"|"error"} AvatarProviderStatus
 */

// The imperative shape every provider view (AnamAvatarView, Local3DAvatarView)
// exposes via useImperativeHandle, and that AvatarContainer forwards to
// whichever one is currently mounted:
//   isLive()            -> boolean, matches AnamAvatar.jsx's existing method
//   streamChunk(text)    -> feed one piece of an in-progress reply
//   endMessage()          -> close out the current turn
//   pause() / resume() / stop() / setMuted(muted) / destroy()
// Not enforced by a TS interface here (plain JS) — kept as documentation and
// as the contract both AnamAvatarView and Local3DAvatarView are written to.
