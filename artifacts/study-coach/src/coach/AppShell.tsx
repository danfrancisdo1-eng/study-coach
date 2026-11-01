import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { BookOpen, MessageCircle, UserRound } from 'lucide-react';
import './coach.css';

export type ShellTab = 'coach' | 'courses' | 'account';

/**
 * D-303: the web app's frame, the phone's three tabs (Coach, Courses, Account): a side menu on a computer,
 * tabs along the bottom at phone width. Courses and Account open the existing account page until their
 * own steps rebuild them.
 */
export default function AppShell({ active, plan, children }: { active: ShellTab; plan: { plan: string; count: string | null; upgrade: boolean } | null; children: ReactNode }) {
  const links: { tab: ShellTab; href: string; label: string; Icon: typeof MessageCircle }[] = [
    { tab: 'coach', href: '/coach', label: 'Coach', Icon: MessageCircle },
    { tab: 'courses', href: '/desk', label: 'Courses', Icon: BookOpen },
    { tab: 'account', href: '/desk', label: 'Account', Icon: UserRound },
  ];
  return <div className="rr-app">
    <nav className="rr-nav" aria-label="Main">
      <div className="rr-brand">RapidRecall AI</div>
      {links.map(({ tab, href, label, Icon }) => <Link key={tab} href={href} className="rr-nav-link" aria-current={tab === active ? 'page' : undefined} data-testid={`link-tab-${tab}`}><Icon size={18} aria-hidden="true" />{label}</Link>)}
      {plan && <div className="rr-plan" data-testid="text-plan">
        <strong>{plan.plan}</strong>
        {plan.count && <span data-testid="text-messages-left">{plan.count}</span>}
        {plan.upgrade && <span>Upgrade in the iPhone app</span>}
      </div>}
    </nav>
    <div className="rr-main">{children}</div>
  </div>;
}
