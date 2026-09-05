import type { Detail, Part, Socket, VoxelScene } from './types.js';

/**
 * Attach an item scene onto a character at one of its sockets.
 *
 * Items stay their own models on disk; this merges a copy into a character to
 * produce a combined scene. Part ids are namespaced so a sword's "blade" can
 * never collide with the character's own parts, and the item's root is
 * re-anchored to the socket, which means the item follows the character if the
 * character is later resized.
 */

export interface AttachOptions {
  /** Overrides the socket's own offset when you need to nudge one item. */
  offset?: [number, number, number];
}

/**
 * Sockets a character exposes. When a scene declares none, derive the four
 * obvious mounting points from its root mass, so any character can be equipped
 * without having to be regenerated.
 *
 * Hand sockets align the item's BOTTOM — items are built grip-down — to about
 * hand height on the body. Aligning centres instead would hang a longsword
 * from its middle, dangling the grip somewhere around the knees.
 */
export function socketsFor(character: VoxelScene): Socket[] {
  if (character.sockets?.length) return character.sockets;

  const root = character.parts.find((p) => p.id === character.root);
  const bodyHeight = root?.size[1] ?? 24;
  const handY = Math.round(bodyHeight * 0.42);

  return [
    {
      id: 'hand_r',
      parent: character.root,
      anchor: { to: 'right', alignY: 'min' },
      offset: [0, handY, 0],
    },
    {
      id: 'hand_l',
      parent: character.root,
      anchor: { to: 'left', alignY: 'min' },
      offset: [0, handY, 0],
    },
    { id: 'back', parent: character.root, anchor: { to: 'back', alignY: 'center' } },
    { id: 'head_top', parent: character.root, anchor: { to: 'top' } },
  ];
}

export function attachItem(
  character: VoxelScene,
  item: VoxelScene,
  socketId: string,
  opts: AttachOptions = {},
): VoxelScene {
  const sockets = socketsFor(character);
  const socket = sockets.find((s) => s.id === socketId);
  if (!socket) {
    throw new Error(
      `Character "${character.name}" has no socket "${socketId}". ` +
        `Available: ${sockets.map((s) => s.id).join(', ')}`,
    );
  }
  if (!character.parts.some((p) => p.id === socket.parent)) {
    throw new Error(`Socket "${socketId}" points at missing part "${socket.parent}"`);
  }

  const prefix = `${item.name}__`;
  const rename = (id: string) => `${prefix}${id}`;
  const taken = new Set(character.parts.map((p) => p.id));
  for (const p of item.parts) {
    if (taken.has(rename(p.id))) {
      throw new Error(`"${item.name}" is already attached to "${character.name}"`);
    }
  }

  const parts: Part[] = item.parts.map((p) => {
    const copy: Part = { ...p, id: rename(p.id) };
    if (p.mirrorOf) copy.mirrorOf = rename(p.mirrorOf);
    if (p.id === item.root) {
      // The item's root becomes a child of the socket's parent.
      delete copy.mirrorOf;
      copy.parent = socket.parent;
      copy.anchor = socket.anchor;
      const off = opts.offset ?? socket.offset;
      if (off) copy.offset = [...off];
      else delete copy.offset;
    } else if (p.parent) {
      copy.parent = rename(p.parent);
    }
    return copy;
  });

  const details: Detail[] = item.details.map((d) => ({
    ...d,
    id: d.id ? rename(d.id) : undefined,
    part: rename(d.part),
  }));

  return {
    ...character,
    kind: 'assembly',
    name: `${character.name}_${item.name}`,
    parts: [...character.parts, ...parts],
    details: [...character.details, ...details],
    meta: {
      ...(character.meta ?? {}),
      attached: [
        ...((character.meta?.attached as Array<Record<string, string>>) ?? []),
        { item: item.name, socket: socketId },
      ],
    },
  };
}
