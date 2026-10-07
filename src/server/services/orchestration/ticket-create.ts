import type { BoardKey, Card } from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { InternalError } from "../domain/errors.js";
import {
  commitAttachments,
  discardStaged,
  stageAttachments,
  type DecodedImage,
} from "../infra/attachments.js";
import { mapBoardUnavailable } from "./boards.js";

/**
 * Create a local ticket on a board, with its pasted images.
 *
 * @remarks Images are staged before the card is minted, so a disk failure never leaves a card
 * whose links point at missing files. A refused mint discards the staged folder.
 */
export async function createTicket(
  board: BoardKey,
  input: {
    title: string;
    fullDescription: string;
    images?: readonly DecodedImage[];
  },
): Promise<Card> {
  const { title, fullDescription, images = [] } = input;
  let staged: string | null;
  try {
    staged = await stageAttachments(images);
  } catch (err) {
    console.warn("[cards] attachment write failed:", (err as Error).message);
    throw new InternalError("attachment-write-failed");
  }
  const card = await store
    .createLocalCard(board, title, fullDescription)
    .catch(async (err: unknown) => {
      if (staged !== null) {
        await discardStaged(staged).catch((cleanup: unknown) => {
          console.warn(
            "[cards] staged attachment cleanup failed:",
            (cleanup as Error).message,
          );
        });
      }
      throw mapBoardUnavailable(err);
    });
  if (staged !== null) {
    try {
      await commitAttachments(staged, card.id);
    } catch (err) {
      console.warn(
        `[cards] attachment commit failed for ${card.id}:`,
        (err as Error).message,
      );
      throw new InternalError("attachment-write-failed");
    }
  }
  return card;
}
