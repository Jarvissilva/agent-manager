import {
  Sparkles,
  Folder,
  Bot,
  BookOpen,
  Activity,
  Clock3,
  Plus,
  ArrowRight,
  Search,
  PanelLeft,
  X,
  Terminal,
  MessageSquare,
  SlidersHorizontal,
  ArrowUp,
  Square,
  History,
  Ellipsis,
  House,
  Plug,
} from 'lucide-react';
import { cn } from '@/lib/utils';
const icons = {
  spark: Sparkles,
  folder: Folder,
  agent: Bot,
  skills: BookOpen,
  activity: Activity,
  clock: Clock3,
  plus: Plus,
  arrow: ArrowRight,
  search: Search,
  menu: PanelLeft,
  close: X,
  terminal: Terminal,
  chat: MessageSquare,
  settings: SlidersHorizontal,
  send: ArrowUp,
  stop: Square,
  history: History,
  more: Ellipsis,
  home: House,
  mcp: Plug,
};
export type IconName = keyof typeof icons;
export default function Icon({
  name,
  className,
}: {
  name: IconName;
  className?: string;
}) {
  const Component = icons[name];
  return (
    <Component
      aria-hidden="true"
      strokeWidth={1.7}
      className={cn('size-4.5 shrink-0', className)}
    />
  );
}
