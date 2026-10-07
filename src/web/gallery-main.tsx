import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import "./styles/tokens.css";
import "./styles/globals.css";
import "./styles/gallery.css";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Theme = "dark" | "light";

const BUTTON_VARIANTS = [
  "default",
  "destructive",
  "outline",
  "secondary",
  "secondary-bordered",
  "surface",
  "ghost",
  "link",
] as const;

const BUTTON_SIZES = [
  "xs",
  "sm",
  "default",
  "lg",
  "icon-xs",
  "icon-sm",
  "icon",
  "icon-lg",
  "icon-compact",
] as const;

const BADGE_TONES = [
  "neutral",
  "accent",
  "success",
  "warning",
  "danger",
] as const;

const ROWS = Array.from({ length: 24 }, (_, index) => `Row ${index + 1}`);

function readInitialTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="border-b border-border pb-2 text-base font-semibold">
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {children}
      </div>
    </section>
  );
}

function Demo({
  title,
  wide = false,
  children,
}: {
  title: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground ${wide ? "md:col-span-2 xl:col-span-3" : ""}`}
    >
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function Gallery() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  function changeTheme(checked: boolean) {
    const next: Theme = checked ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    document
      .querySelector('meta[name="color-scheme"]')
      ?.setAttribute("content", next);
    try {
      localStorage.setItem("dsp.theme", next);
    } catch (error) {
      void error;
    }
  }

  return (
    <TooltipProvider>
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 bg-background p-4 text-foreground md:p-8">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold">UI Gallery</h1>
          <div className="flex items-center gap-2">
            <Label htmlFor="gallery-theme" className="text-muted-foreground">
              Dark theme
            </Label>
            <Switch
              id="gallery-theme"
              checked={theme === "dark"}
              onCheckedChange={changeTheme}
            />
          </div>
        </header>

        <Section title="Actions">
          <Demo title="Button variants" wide>
            <div className="flex flex-wrap gap-2">
              {BUTTON_VARIANTS.map((variant) => (
                <Button key={variant} variant={variant}>
                  {variant}
                </Button>
              ))}
            </div>
          </Demo>
          <Demo title="Button sizes" wide>
            <div className="flex flex-wrap items-center gap-2">
              {BUTTON_SIZES.map((size) => (
                <Button key={size} size={size} variant="outline">
                  {size.startsWith("icon") ? "+" : size}
                </Button>
              ))}
            </div>
          </Demo>
          <Demo title="Toggle">
            <div className="flex gap-2">
              <Toggle aria-label="Bold">Bold</Toggle>
              <Toggle aria-label="Italic" variant="outline">
                Italic
              </Toggle>
            </div>
          </Demo>
          <Demo title="ToggleGroup">
            <ToggleGroup type="single" variant="outline" defaultValue="left">
              <ToggleGroupItem value="left">Left</ToggleGroupItem>
              <ToggleGroupItem value="center">Center</ToggleGroupItem>
              <ToggleGroupItem value="right">Right</ToggleGroupItem>
            </ToggleGroup>
          </Demo>
          <Demo title="Kbd">
            <KbdGroup>
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </Demo>
        </Section>

        <Section title="Forms">
          <Demo title="Label and Input">
            <div className="flex flex-col gap-2">
              <Label htmlFor="gallery-name">Name</Label>
              <Input id="gallery-name" placeholder="Ada Lovelace" />
              <Input
                aria-label="Surface input"
                variant="surface"
                placeholder="Surface variant"
              />
            </div>
          </Demo>
          <Demo title="Textarea">
            <div className="flex flex-col gap-2">
              <Textarea aria-label="Notes" placeholder="Write a note" />
              <Textarea
                aria-label="Surface notes"
                variant="surface"
                placeholder="Surface variant"
              />
            </div>
          </Demo>
          <Demo title="Field">
            <Field>
              <FieldLabel htmlFor="gallery-email">Email</FieldLabel>
              <Input id="gallery-email" type="email" placeholder="a@b.co" />
              <FieldDescription>We never share your address.</FieldDescription>
            </Field>
          </Demo>
          <Demo title="Checkbox">
            <div className="flex items-center gap-2">
              <Checkbox id="gallery-terms" />
              <Label htmlFor="gallery-terms">Accept terms</Label>
            </div>
          </Demo>
          <Demo title="Switch">
            <div className="flex items-center gap-2">
              <Switch id="gallery-alerts" />
              <Label htmlFor="gallery-alerts">Alerts</Label>
            </div>
          </Demo>
          <Demo title="Select">
            <Select defaultValue="apple">
              <SelectTrigger aria-label="Fruit" className="w-full">
                <SelectValue placeholder="Pick a fruit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="apple">Apple</SelectItem>
                <SelectItem value="banana">Banana</SelectItem>
                <SelectItem value="cherry">Cherry</SelectItem>
              </SelectContent>
            </Select>
            <Select defaultValue="apple">
              <SelectTrigger
                aria-label="Surface fruit"
                variant="surface"
                className="w-full"
              >
                <SelectValue placeholder="Pick a fruit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="apple">Apple</SelectItem>
              </SelectContent>
            </Select>
          </Demo>
        </Section>

        <Section title="Feedback">
          <Demo title="Alert">
            <div className="flex flex-col gap-2">
              <Alert>
                <AlertTitle>Default</AlertTitle>
                <AlertDescription>A neutral message.</AlertDescription>
              </Alert>
              <Alert variant="muted">
                <AlertTitle>Muted</AlertTitle>
                <AlertDescription>A quiet message.</AlertDescription>
              </Alert>
              <Alert variant="destructive">
                <AlertTitle>Destructive</AlertTitle>
                <AlertDescription>Something failed.</AlertDescription>
              </Alert>
            </div>
          </Demo>
          <Demo title="Badge tones">
            <div className="flex flex-wrap gap-2">
              {BADGE_TONES.map((tone) => (
                <Badge key={tone} tone={tone}>
                  {tone}
                </Badge>
              ))}
              <Badge tone="state" stateColor="var(--accent)">
                state
              </Badge>
            </div>
          </Demo>
          <Demo title="Progress">
            <Progress value={60} aria-label="Progress" />
          </Demo>
          <Demo title="Skeleton">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </Demo>
          <Demo title="Spinner">
            <Spinner />
          </Demo>
          <Demo title="Empty">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No results</EmptyTitle>
                <EmptyDescription>Try a different search.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm">Reset</Button>
              </EmptyContent>
            </Empty>
          </Demo>
          <Demo title="Sonner">
            <Button
              variant="outline"
              onClick={() =>
                toast("Saved", { action: { label: "Undo", onClick: () => {} } })
              }
            >
              Show toast
            </Button>
            <Toaster theme={theme} />
          </Demo>
        </Section>

        <Section title="Overlays">
          <Demo title="Dialog">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Open dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Dialog title</DialogTitle>
                  <DialogDescription>Dialog description.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button>Close</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </Demo>
          <Demo title="AlertDialog">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Delete</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Demo>
          <Demo title="Sheet">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Open sheet</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Sheet title</SheetTitle>
                  <SheetDescription>Sheet description.</SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>
          </Demo>
          <Demo title="Popover">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Open popover</Button>
              </PopoverTrigger>
              <PopoverContent>
                <PopoverHeader>
                  <PopoverTitle>Popover title</PopoverTitle>
                  <PopoverDescription>Popover description.</PopoverDescription>
                </PopoverHeader>
              </PopoverContent>
            </Popover>
          </Demo>
          <Demo title="Tooltip">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">Hover me</Button>
              </TooltipTrigger>
              <TooltipContent>Tooltip text</TooltipContent>
            </Tooltip>
          </Demo>
          <Demo title="DropdownMenu">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Open menu</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Profile</DropdownMenuItem>
                <DropdownMenuItem>Settings</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Demo>
          <Demo title="Command">
            <Command className="rounded-md border border-border">
              <CommandInput placeholder="Type a command" />
              <CommandList>
                <CommandGroup heading="Suggestions">
                  <CommandItem>
                    Calendar <CommandShortcut>C</CommandShortcut>
                  </CommandItem>
                  <CommandItem>Search</CommandItem>
                  <CommandItem>Settings</CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </Demo>
        </Section>

        <Section title="Layout and data">
          <Demo title="Card">
            <Card>
              <CardHeader>
                <CardTitle>Card title</CardTitle>
                <CardDescription>Card description.</CardDescription>
              </CardHeader>
              <CardContent>Card content.</CardContent>
              <CardFooter>
                <Button size="sm">Action</Button>
              </CardFooter>
            </Card>
          </Demo>
          <Demo title="Separator">
            <div className="flex flex-col gap-2">
              <span>Above</span>
              <Separator />
              <span>Below</span>
            </div>
          </Demo>
          <Demo title="ScrollArea">
            <ScrollArea className="h-40 rounded-md border border-border">
              <div className="flex flex-col gap-2 p-3">
                {ROWS.map((row) => (
                  <span key={row}>{row}</span>
                ))}
              </div>
            </ScrollArea>
          </Demo>
          <Demo title="Resizable" wide>
            <div className="overflow-x-auto">
              <div className="h-32 min-w-72 rounded-md border border-border">
                <ResizablePanelGroup orientation="horizontal">
                  <ResizablePanel defaultSize={50}>
                    <div className="p-3">One</div>
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize={50}>
                    <div className="p-3">Two</div>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </div>
            </div>
          </Demo>
          <Demo title="Tabs">
            <Tabs defaultValue="one">
              <TabsList>
                <TabsTrigger value="one">One</TabsTrigger>
                <TabsTrigger value="two">Two</TabsTrigger>
              </TabsList>
              <TabsContent value="one">First panel.</TabsContent>
              <TabsContent value="two">Second panel.</TabsContent>
            </Tabs>
          </Demo>
          <Demo title="Collapsible">
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm">
                  Toggle
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                Hidden content.
              </CollapsibleContent>
            </Collapsible>
          </Demo>
          <Demo title="Item">
            <Item variant="outline">
              <ItemContent>
                <ItemTitle>Item title</ItemTitle>
                <ItemDescription>Item description.</ItemDescription>
              </ItemContent>
            </Item>
            <Item selected>
              <ItemContent>
                <ItemTitle>Selected item</ItemTitle>
                <ItemDescription>Selected variant.</ItemDescription>
              </ItemContent>
            </Item>
          </Demo>
          <Demo title="Table" wide>
            <div className="overflow-x-auto">
              <Table>
                <TableCaption>Recent sessions</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Owner</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>alpha</TableCell>
                    <TableCell>Running</TableCell>
                    <TableCell>Ada</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>beta</TableCell>
                    <TableCell>Stopped</TableCell>
                    <TableCell>Grace</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </Demo>
          <Demo title="Pagination" wide>
            <div className="overflow-x-auto">
              <Pagination className="min-w-max">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious href="#" />
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#">1</PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#" isActive>
                      2
                    </PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationEllipsis />
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext href="#" />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </Demo>
        </Section>

        <Section title="Navigation">
          <Demo title="Sidebar" wide>
            <div className="h-64 overflow-x-auto rounded-md border border-border">
              <SidebarProvider className="h-full min-h-0">
                <Sidebar collapsible="none">
                  <SidebarContent>
                    <SidebarGroup>
                      <SidebarGroupLabel>Workspace</SidebarGroupLabel>
                      <SidebarGroupContent>
                        <SidebarMenu>
                          <SidebarMenuItem>
                            <SidebarMenuButton isActive>
                              Overview
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                          <SidebarMenuItem>
                            <SidebarMenuButton>Sessions</SidebarMenuButton>
                          </SidebarMenuItem>
                          <SidebarMenuItem>
                            <SidebarMenuButton>Settings</SidebarMenuButton>
                          </SidebarMenuItem>
                        </SidebarMenu>
                      </SidebarGroupContent>
                    </SidebarGroup>
                  </SidebarContent>
                </Sidebar>
              </SidebarProvider>
            </div>
          </Demo>
        </Section>
      </main>
    </TooltipProvider>
  );
}

const rootEl = document.getElementById("gallery");
if (!rootEl) {
  throw new Error("Missing #gallery element");
}

createRoot(rootEl).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
