import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronRight, Folder, FolderGit2 } from "lucide-react";
import type { DirEntry, DirListing } from "../../../shared/types.js";
import { browseDirectory } from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Modal } from "../../primitives/Modal.js";
import { Notice } from "../../primitives/Notice.js";

const LAST_DIR_KEY = "dispatch:folder-browser-last-dir";

function readLastDir(): string | null {
  try {
    return localStorage.getItem(LAST_DIR_KEY);
  } catch {
    return null;
  }
}

function writeLastDir(path: string): void {
  try {
    localStorage.setItem(LAST_DIR_KEY, path);
  } catch {}
}

const focusRing = (on: boolean): string =>
  on ? "0 0 0 2px var(--accent)" : "none";

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

interface BreadcrumbSegmentProps {
  label: string;
  isLast: boolean;
  onClick: () => void;
}

function BreadcrumbSegment({ label, isLast, onClick }: BreadcrumbSegmentProps) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);

  if (isLast) {
    return (
      <span
        style={{
          flex: "0 0 auto",
          fontFamily: "var(--font-label)",
          fontSize: "var(--font-label)",
          fontWeight: "var(--weight-semibold)",
          lineHeight: "var(--line-label)",
          color: "var(--text)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={(e) => setFocus(e.currentTarget.matches(":focus-visible"))}
      onBlur={() => setFocus(false)}
      style={{
        flex: "0 0 auto",
        padding: 0,
        background: "transparent",
        border: "none",
        borderRadius: "var(--radius)",
        fontFamily: "var(--font-label)",
        fontSize: "var(--font-label)",
        fontWeight: "var(--weight-semibold)",
        lineHeight: "var(--line-label)",
        color: hover ? "var(--text)" : "var(--text-muted)",
        whiteSpace: "nowrap",
        cursor: "pointer",
        outline: "none",
        boxShadow: focusRing(focus),
      }}
    >
      {label}
    </button>
  );
}

interface DirRowProps {
  entry: DirEntry;
  highlighted: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}

function DirRow({ entry, highlighted, onClick, onDoubleClick }: DirRowProps) {
  const [hover, setHover] = useState(false);
  const Icon = entry.hasGit ? FolderGit2 : Folder;
  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "var(--space-sm)",
        borderRadius: "var(--radius)",
        background:
          hover || highlighted ? "var(--surface-card-hover)" : "transparent",
        cursor: "pointer",
      }}
    >
      <Icon
        size={14}
        strokeWidth={2}
        aria-hidden="true"
        style={{ color: "var(--text-muted)", flex: "0 0 auto" }}
      />
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-label)",
          lineHeight: "var(--line-label)",
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {entry.name}
      </span>
    </div>
  );
}

const mutedRowStyle: CSSProperties = {
  padding: "var(--space-sm)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

interface FolderBrowserModalProps {
  onClose: () => void;
  onSelect: (path: string) => void;
}

export function FolderBrowserModal({
  onClose,
  onSelect,
}: FolderBrowserModalProps) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [homeRoot, setHomeRoot] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(-1);
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listFocus, setListFocus] = useState(false);
  const genRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const myGen = ++genRef.current;
    setLoading(true);
    void (async () => {
      try {
        const home = await browseDirectory();
        if (genRef.current !== myGen) return;
        setHomeRoot(home.path);
        const remembered = readLastDir();
        if (remembered && remembered !== home.path) {
          try {
            const atRemembered = await browseDirectory(remembered);
            if (genRef.current !== myGen) return;
            setListing(atRemembered);
            writeLastDir(atRemembered.path);
            return;
          } catch {}
        }
        setListing(home);
      } finally {
        if (genRef.current === myGen) setLoading(false);
      }
    })();
  }, []);

  function navigate(target: string) {
    const myGen = ++genRef.current;
    setLoading(true);
    void (async () => {
      try {
        const result = await browseDirectory(target);
        if (genRef.current !== myGen) return;
        setListing(result);
        setHighlighted(-1);
        writeLastDir(result.path);
      } catch {
      } finally {
        if (genRef.current === myGen) setLoading(false);
      }
    })();
  }

  const filteredEntries = listing
    ? listing.entries.filter((e) => showHidden || !e.hidden)
    : [];

  const breadcrumbItems =
    homeRoot && listing
      ? [
          { label: "Home", path: homeRoot },
          ...listing.path
            .slice(homeRoot.length)
            .split("/")
            .filter(Boolean)
            .map((name, i, all) => ({
              label: name,
              path: `${homeRoot}/${all.slice(0, i + 1).join("/")}`,
            })),
        ]
      : [];

  function confirmCurrent() {
    if (!listing) return;
    writeLastDir(listing.path);
    onSelect(listing.path);
  }

  return (
    <Modal
      ariaLabel="Browse folders"
      title={listing ? basename(listing.path) : "Browse folders"}
      onClose={onClose}
      dialogStyle={{ width: "560px", maxHeight: "70vh" }}
      footer={
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            flex: "0 0 auto",
          }}
        >
          <Button
            variant="primary"
            disabled={listing === null}
            onClick={confirmCurrent}
          >
            Select this folder
          </Button>
        </div>
      }
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-lg)",
          flex: "1 1 auto",
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-lg)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-xs)",
              overflowX: "auto",
              whiteSpace: "nowrap",
              flex: "1 1 auto",
              minWidth: 0,
            }}
          >
            {breadcrumbItems.map((item, idx) => (
              <div
                key={item.path}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-xs)",
                  flex: "0 0 auto",
                }}
              >
                {idx > 0 && (
                  <ChevronRight
                    size={12}
                    strokeWidth={2}
                    aria-hidden="true"
                    style={{ color: "var(--text-muted)" }}
                  />
                )}
                <BreadcrumbSegment
                  label={item.label}
                  isLast={idx === breadcrumbItems.length - 1}
                  onClick={() => navigate(item.path)}
                />
              </div>
            ))}
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-xs)",
              flex: "0 0 auto",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => {
                setShowHidden(e.target.checked);
                setHighlighted(-1);
              }}
              style={{ accentColor: "var(--accent)" }}
            />
            <span
              style={{
                fontFamily: "var(--font-label)",
                fontSize: "var(--font-label)",
                fontWeight: "var(--weight-semibold)",
                lineHeight: "var(--line-label)",
                color: "var(--text-muted)",
                whiteSpace: "nowrap",
              }}
            >
              Show hidden folders
            </span>
          </label>
        </div>

        <div
          ref={listRef}
          tabIndex={0}
          onFocus={(e) =>
            setListFocus(e.currentTarget.matches(":focus-visible"))
          }
          onBlur={() => setListFocus(false)}
          onKeyDown={(e) => {
            if (!listing) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlighted((i) =>
                Math.min(i + 1, filteredEntries.length - 1),
              );
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlighted((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              if (highlighted >= 0 && highlighted < filteredEntries.length) {
                e.preventDefault();
                navigate(filteredEntries[highlighted].path);
              }
            } else if (e.key === "Backspace") {
              e.preventDefault();
              if (listing.parent !== null) navigate(listing.parent);
            }
          }}
          style={{
            height: "360px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            outline: "none",
            boxShadow: focusRing(listFocus),
            borderRadius: "var(--radius)",
          }}
        >
          {loading && <span style={mutedRowStyle}>Loading…</span>}
          {!loading && listing?.readable === false && (
            <Notice tone="destructive" label="Can't read this folder" />
          )}
          {!loading &&
            listing?.readable !== false &&
            filteredEntries.length === 0 && (
              <span style={mutedRowStyle}>No subfolders here.</span>
            )}
          {!loading &&
            listing?.readable !== false &&
            filteredEntries.map((entry, index) => (
              <div
                key={entry.path}
                ref={(node) => {
                  if (node && index === highlighted) {
                    node.scrollIntoView({ block: "nearest" });
                  }
                }}
              >
                <DirRow
                  entry={entry}
                  highlighted={index === highlighted}
                  onClick={() => setHighlighted(index)}
                  onDoubleClick={() => navigate(entry.path)}
                />
              </div>
            ))}
        </div>
      </div>
    </Modal>
  );
}
