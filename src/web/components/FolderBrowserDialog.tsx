import { useEffect, useRef, useState } from "react";
import { ChevronRight, Folder, FolderGit2 } from "lucide-react";
import type { DirListing } from "../../shared/types.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

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

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

function breadcrumbsFor(
  homeRoot: string | null,
  listing: DirListing | undefined,
) {
  if (!homeRoot || !listing) return [];
  return [
    { label: "Home", path: homeRoot },
    ...listing.path
      .slice(homeRoot.length)
      .split("/")
      .filter(Boolean)
      .map((name, i, all) => ({
        label: name,
        path: `${homeRoot}/${all.slice(0, i + 1).join("/")}`,
      })),
  ];
}

function focusOnMount(node: HTMLElement | null): void {
  node?.focus();
}

type Step = "home" | "remembered" | "ready";

interface FolderBrowserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listing: DirListing | undefined;
  loading: boolean;
  error: boolean;
  onNavigate: (path: string | undefined) => void;
  onSelect: (path: string) => void;
}

type FolderBrowserBodyProps = Omit<
  FolderBrowserDialogProps,
  "open" | "onOpenChange"
>;

function highlightIgnoringAutoPick(
  keyed: boolean,
  value: string,
  prev: string,
): string {
  if (keyed) return value;
  return prev === "" ? " " : "";
}

function FolderBrowserBody({
  listing,
  loading,
  error,
  onNavigate,
  onSelect,
}: FolderBrowserBodyProps) {
  const [step, setStep] = useState<Step>("home");
  const [homeRoot, setHomeRoot] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const persist = useRef(false);
  const keyed = useRef(false);

  useEffect(() => {
    onNavigate(undefined);
  }, [onNavigate]);

  useEffect(() => {
    if (step === "ready" || loading) return;
    if (step === "home") {
      if (listing) {
        setHomeRoot(listing.path);
        const remembered = readLastDir();
        if (remembered && remembered !== listing.path) {
          setStep("remembered");
          onNavigate(remembered);
        } else {
          setStep("ready");
        }
      } else if (error) {
        setStep("ready");
      }
      return;
    }
    if (listing?.readable) {
      persist.current = true;
      setStep("ready");
    } else if (listing || error) {
      setStep("ready");
      onNavigate(undefined);
    }
  }, [step, listing, loading, error, onNavigate]);

  useEffect(() => {
    if (step === "ready" && persist.current && listing && !loading && !error) {
      writeLastDir(listing.path);
    }
  }, [step, listing, loading, error]);

  function navigate(path: string) {
    persist.current = true;
    keyed.current = false;
    setHighlighted("");
    onNavigate(path);
  }

  const entries = listing
    ? listing.entries.filter((e) => showHidden || !e.hidden)
    : [];
  const crumbs = breadcrumbsFor(homeRoot, listing);
  const showLoading = loading || (listing === undefined && !error);
  const settled = !showLoading && !error;

  function confirmCurrent() {
    if (!listing) return;
    writeLastDir(listing.path);
    onSelect(listing.path);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {listing ? basename(listing.path) : "Browse folders"}
        </DialogTitle>
      </DialogHeader>
      <div className="flex min-h-0 flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap">
            {crumbs.map((item, idx) => (
              <div key={item.path} className="flex shrink-0 items-center gap-1">
                {idx > 0 && (
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3 text-muted-foreground"
                  />
                )}
                {idx === crumbs.length - 1 ? (
                  <span className="text-sm font-semibold whitespace-nowrap text-foreground">
                    {item.label}
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="font-semibold text-muted-foreground"
                    onClick={() => navigate(item.path)}
                  >
                    {item.label}
                  </Button>
                )}
              </div>
            ))}
          </div>
          <Label className="shrink-0 cursor-pointer gap-1 text-sm font-semibold whitespace-nowrap text-muted-foreground">
            <Checkbox
              checked={showHidden}
              onCheckedChange={(checked) => {
                setShowHidden(checked === true);
                keyed.current = false;
                setHighlighted("");
              }}
            />
            Show hidden folders
          </Label>
        </div>

        <Command
          shouldFilter={false}
          loop={false}
          tabIndex={0}
          disablePointerSelection
          value={highlighted}
          onValueChange={(value) =>
            setHighlighted((prev) =>
              highlightIgnoringAutoPick(keyed.current, value, prev),
            )
          }
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              keyed.current = true;
            }
            if (!listing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              if (entries.some((entry) => entry.path === highlighted)) {
                navigate(highlighted);
              }
            } else if (e.key === "Backspace") {
              e.preventDefault();
              if (listing.parent !== null) navigate(listing.parent);
            }
          }}
          ref={focusOnMount}
          className="h-90 shrink-0 rounded-md bg-transparent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <CommandList className="h-full max-h-none [scrollbar-gutter:stable]">
            {showLoading && (
              <p className="p-2 text-sm font-semibold text-muted-foreground">
                Loading…
              </p>
            )}
            {!showLoading && error && (
              <Alert variant="destructive">
                <AlertDescription className="font-semibold">
                  Couldn't reach the server. Try again.
                </AlertDescription>
              </Alert>
            )}
            {settled && listing?.readable === false && (
              <Alert variant="destructive">
                <AlertDescription className="font-semibold">
                  Can't read this folder
                </AlertDescription>
              </Alert>
            )}
            {settled && listing?.readable !== false && entries.length === 0 && (
              <p className="p-2 text-sm font-semibold text-muted-foreground">
                No subfolders here.
              </p>
            )}
            {settled &&
              listing?.readable !== false &&
              entries.map((entry) => {
                const Icon = entry.hasGit ? FolderGit2 : Folder;
                return (
                  <CommandItem
                    key={entry.path}
                    value={entry.path}
                    onSelect={() => {
                      keyed.current = true;
                      setHighlighted(entry.path);
                    }}
                    onDoubleClick={() => navigate(entry.path)}
                    className="gap-2 p-2 hover:bg-accent data-[selected=true]:bg-accent data-[selected=true]:text-foreground"
                  >
                    <Icon aria-hidden="true" className="size-3.5" />
                    <span className="min-w-0 truncate font-mono text-sm">
                      {entry.name}
                    </span>
                  </CommandItem>
                );
              })}
          </CommandList>
        </Command>
      </div>
      <DialogFooter>
        <Button disabled={listing === undefined} onClick={confirmCurrent}>
          Select this folder
        </Button>
      </DialogFooter>
    </>
  );
}

export function FolderBrowserDialog({
  open,
  onOpenChange,
  ...body
}: FolderBrowserDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-label="Browse folders"
        aria-labelledby={undefined}
        aria-describedby={undefined}
        className="max-h-[70vh] sm:max-w-140"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <FolderBrowserBody {...body} />
      </DialogContent>
    </Dialog>
  );
}
