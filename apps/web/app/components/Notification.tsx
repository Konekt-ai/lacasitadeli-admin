import { cn } from '../lib/utils';
import { Icon } from './Icon';

interface Props { msg: string; type: 'success' | 'error'; }

export const Notification = ({ msg, type }: Props) => (
  <div className={cn(
    'fixed top-4 right-4 z-[110] px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 border animate-in slide-in-from-top-4 duration-300',
    type === 'success'
      ? 'bg-primary text-white border-primary-fixed-dim'
      : 'bg-error text-on-error border-error-container'
  )}>
    <Icon name={type === 'success' ? 'check_circle' : 'error'} className="text-xl" />
    <p className="text-sm font-label font-bold">{msg}</p>
  </div>
);
