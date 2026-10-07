import { create } from "zustand";

export type UnsavedChoice = "save" | "discard" | "cancel";

interface ConfirmRequest {
  projectName: string;
  resolve(choice: UnsavedChoice): void;
}

interface ConfirmState {
  request: ConfirmRequest | null;
}

export const useConfirmStore = create<ConfirmState>()(() => ({ request: null }));

/** Asks "save changes?" and resolves with the user's choice. */
export function askUnsaved(projectName: string): Promise<UnsavedChoice> {
  return new Promise((resolve) => {
    useConfirmStore.getState().request?.resolve("cancel");
    useConfirmStore.setState({
      request: {
        projectName,
        resolve: (choice) => {
          useConfirmStore.setState({ request: null });
          resolve(choice);
        },
      },
    });
  });
}
