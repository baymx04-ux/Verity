import { Inbox, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Accordion } from '../components/ui/accordion';
import { Alert } from '../components/ui/alert';
import { Avatar } from '../components/ui/avatar';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { Checkbox, Radio } from '../components/ui/checkbox';
import { Dialog } from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../components/ui/dropdown-menu';
import { EmptyState } from '../components/ui/empty-state';
import { IconButton } from '../components/ui/icon-button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Pagination } from '../components/ui/pagination';
import { Select } from '../components/ui/select';
import { Separator } from '../components/ui/separator';
import { Sheet } from '../components/ui/sheet';
import { Skeleton } from '../components/ui/skeleton';
import { Spinner } from '../components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../components/ui/table';
import { Tabs } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { Tooltip } from '../components/ui/tooltip';

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="scroll-mt-24" id={title.toLowerCase().replace(/\s+/g, '-')}>
      <div className="mb-3">
        <h2 className="font-display text-display-md text-ink-900">{title}</h2>
        <p className="text-body-sm text-ink-500">{description}</p>
      </div>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">{children}</CardContent>
      </Card>
    </section>
  );
}

export function ComponentGalleryPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [page, setPage] = useState(2);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-8">
        <Badge variant="warning">Development only</Badge>
        <h1 className="mt-2 font-display text-display-lg text-ink-900">Component gallery</h1>
        <p className="mt-1 max-w-2xl text-body-md text-ink-500">
          Visual reference for the Verity design system. This route is excluded from production
          navigation and only exists in development builds.
        </p>
      </header>

      <div className="space-y-8">
        <Section
          title="Buttons"
          description="Primary, secondary, subtle, ghost, destructive, and icon buttons."
        >
          <Button>Primary action</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="subtle">Subtle</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Delete</Button>
          <Button disabled>Disabled</Button>
          <IconButton aria-label="Add item" variant="secondary">
            <Plus aria-hidden="true" />
          </IconButton>
          <IconButton aria-label="Delete item">
            <Trash2 aria-hidden="true" />
          </IconButton>
          <Spinner label="Loading preview" />
        </Section>

        <Section title="Badges" description="Status and filter pills.">
          <Badge>Neutral</Badge>
          <Badge variant="verified">Verified</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="danger">Danger</Badge>
        </Section>

        <Section title="Avatars" description="Initials fall back to the local part of an email.">
          <Avatar name="Ada Admin" size="sm" />
          <Avatar name="Anu Analyst" size="md" />
          <Avatar email="viewer@verity.dev" size="lg" />
        </Section>

        <Section
          title="Alerts"
          description="Inline status messaging with an icon and semantic role."
        >
          <div className="grid w-full gap-3 md:grid-cols-2">
            <Alert variant="info" title="Heads up">
              Informational context for the current view.
            </Alert>
            <Alert variant="success" title="Verified">
              The answer passed grounding checks.
            </Alert>
            <Alert variant="warning" title="Partial result">
              Some sources could not be reached.
            </Alert>
            <Alert variant="danger" title="Query rejected">
              The statement was blocked by SQL safety.
            </Alert>
          </div>
        </Section>

        <Section
          title="Forms"
          description="Inputs, textarea, select, checkbox, and radio controls."
        >
          <div className="grid w-full gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="gallery-name">Name</Label>
              <Input id="gallery-name" placeholder="Ada Lovelace" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gallery-role">Role</Label>
              <Select id="gallery-role" defaultValue="analyst">
                <option value="admin">Admin</option>
                <option value="analyst">Analyst</option>
                <option value="viewer">Viewer</option>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="gallery-notes">Notes</Label>
              <Textarea id="gallery-notes" placeholder="Add context for the reviewer…" />
            </div>
            <label className="flex items-center gap-2 text-body-md text-ink-700">
              <Checkbox defaultChecked /> Include archived documents
            </label>
            <label className="flex items-center gap-2 text-body-md text-ink-700">
              <Radio name="gallery-scope" defaultChecked /> Workspace scope
            </label>
          </div>
        </Section>

        <Section
          title="Tabs"
          description="Keyboard navigable tabs with arrow, Home, and End support."
        >
          <Tabs
            className="w-full"
            items={[
              {
                id: 'overview',
                label: 'Overview',
                content: (
                  <p className="text-body-md text-ink-700">Summary of the selected answer.</p>
                ),
              },
              {
                id: 'sources',
                label: 'Sources',
                content: (
                  <p className="text-body-md text-ink-700">
                    Citations remain visible beside the answer.
                  </p>
                ),
              },
              {
                id: 'sql',
                label: 'SQL',
                content: (
                  <pre className="rounded-nested bg-inset p-4 font-mono text-body-sm text-ink-700">
                    SELECT date, revenue FROM finance.monthly;
                  </pre>
                ),
              },
            ]}
          />
        </Section>

        <Section
          title="Table"
          description="Hairline rows, tabular values, no vertical cell dividers."
        >
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Document</TableHeaderCell>
                <TableHeaderCell>Owner</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell className="text-right">Chunks</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {[
                ['Q3 revenue plan', 'Finance', 'Indexed', '148'],
                ['Travel policy', 'People', 'Processing', '32'],
                ['Security handbook', 'Engineering', 'Indexed', '91'],
              ].map(([document, owner, status, chunks]) => (
                <TableRow key={document}>
                  <TableCell className="font-medium text-ink-900">{document}</TableCell>
                  <TableCell>{owner}</TableCell>
                  <TableCell>
                    <Badge variant={status === 'Indexed' ? 'verified' : 'warning'}>{status}</Badge>
                  </TableCell>
                  <TableCell className="tabular text-right">{chunks}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>

        <Section
          title="Empty and loading"
          description="Honest empty states and skeleton placeholders."
        >
          <div className="grid w-full gap-4 md:grid-cols-2">
            <EmptyState
              icon={<Inbox aria-hidden="true" />}
              title="Nothing to review"
              description="New items will appear here when ingestion runs."
            />
            <div className="space-y-3 rounded-nested border border-line p-4">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
              <Separator className="my-3" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        </Section>

        <Section
          title="Overlays and menus"
          description="Dialog, sheet, dropdown menu, and tooltip primitives."
        >
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Open dialog
          </Button>
          <Button variant="secondary" onClick={() => setSheetOpen(true)}>
            Open sheet
          </Button>
          <DropdownMenu
            label="Example menu"
            trigger={(props) => (
              <Button variant="secondary" {...props}>
                Open menu
              </Button>
            )}
          >
            <DropdownMenuItem>View details</DropdownMenuItem>
            <DropdownMenuItem>Copy citation</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive>Remove</DropdownMenuItem>
          </DropdownMenu>
          <Tooltip label="Tooltips clarify icon-only controls">
            <Button variant="ghost">Hover or focus me</Button>
          </Tooltip>
        </Section>

        <Section
          title="Disclosure and pagination"
          description="Accordion and page navigation controls."
        >
          <div className="w-full space-y-4">
            <Accordion
              items={[
                {
                  id: 'citations',
                  title: 'How citations are attached',
                  content: 'Each retrieved chunk keeps its document, page, and character offsets.',
                },
                {
                  id: 'refusals',
                  title: 'When Verity refuses',
                  content:
                    'If grounded evidence is missing, the answer states that clearly instead of guessing.',
                },
              ]}
            />
            <Pagination page={page} pageCount={4} onPageChange={setPage} />
          </div>
        </Section>

        <Section title="Cards" description="Card, header, content, and footer composition.">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Card title</CardTitle>
              <CardDescription>Supporting description for the module.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-body-md text-ink-700">
                Cards use the surface, hairline, and diffused shadow tokens.
              </p>
            </CardContent>
            <CardFooter>
              <span className="text-body-sm text-ink-500">Updated just now</span>
              <Button size="sm">Action</Button>
            </CardFooter>
          </Card>
        </Section>
      </div>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Delete conversation?"
        description="This removes the thread from your workspace. Citations already saved elsewhere are unaffected."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => setDialogOpen(false)}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-body-md text-ink-700">
          Dialog content lives inside a focusable, labelled surface.
        </p>
      </Dialog>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Source details"
        description="A right-side panel for inspection without losing the thread."
        footer={
          <Button variant="secondary" onClick={() => setSheetOpen(false)}>
            Close
          </Button>
        }
      >
        <p className="text-body-md text-ink-700">
          Sheets host citations, document previews, and long inspection detail.
        </p>
      </Sheet>
    </div>
  );
}
