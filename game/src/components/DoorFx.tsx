// Compatibility shell for Play. Opening the story is now an explicit Doors
// state; ordinary scene navigation must never replay the entrance artwork.
export function DoorFx({ token }: { token: number }) {
  void token;
  return null;
}
