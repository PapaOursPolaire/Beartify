console.log({
  currentTrackId: window.SpotifyLyricsSaver?.state?.currentTrackId,
  savedTrackIds: [...(window.SpotifyLyricsSaver?.state?.savedTrackIds ?? [])],
  savedScore: window.SpotifyLyricsSaver?.state?.savedScore,
  pending: Object.keys(window.SpotifyLyricsSaver?.state?.pending ?? {}),
  totalSaved: window.SpotifyLyricsSaver?.state?.totalSaved,
})
