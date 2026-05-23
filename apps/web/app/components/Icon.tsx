import { cn } from '../lib/utils';

export const Icon = ({ name, className }: { name: string; className?: string }) => (
  <span className={cn('material-symbols-outlined', className)} data-icon={name}>{name}</span>
);
