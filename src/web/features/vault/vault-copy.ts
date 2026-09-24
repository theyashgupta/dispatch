/** Maps an add-key error code to its inline copy, with one fallback for unknown codes. */
export function vaultAddErrorCopy(error: string): string {
  switch (error) {
    case "invalid-name":
      return "Use uppercase letters, digits and underscores only, starting with a letter or underscore.";
    case "name-exists":
      return "A key with this name already exists.";
    case "invalid-purpose":
      return "Enter a one-line purpose.";
    default:
      return "Couldn't add key, try again.";
  }
}

/** Maps a set-value error code to its inline copy, with one fallback for unknown codes. */
export function vaultValueErrorCopy(error: string): string {
  switch (error) {
    case "missing-value":
      return "Enter a value.";
    case "invalid-value":
      return "Value must be a single line, under 8KB.";
    case "not-found":
      return "This key no longer exists, reopen the page to retry.";
    default:
      return "Couldn't save value, try again.";
  }
}

/** Maps a purpose-edit error code to its inline copy, with one fallback for unknown codes. */
export function vaultPurposeErrorCopy(error: string): string {
  switch (error) {
    case "invalid-purpose":
      return "Enter a one-line purpose.";
    case "not-found":
      return "This key no longer exists, reopen the page to retry.";
    default:
      return "Couldn't update purpose, try again.";
  }
}
