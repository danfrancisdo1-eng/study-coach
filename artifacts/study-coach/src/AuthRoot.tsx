import { useEffect, useRef } from 'react';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import LegacyApp from './App';
import { AccountPage } from './AccountPage';

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const queryClient = new QueryClient();

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#bb593b',
    colorForeground: '#283348',
    colorMutedForeground: '#536172',
    colorBackground: '#fffdf7',
    colorInput: '#fffdf7',
    colorInputForeground: '#283348',
    colorDanger: '#9b392b',
    colorNeutral: '#c8c1b3',
    fontFamily: '"DM Sans", sans-serif',
    borderRadius: '12px',
  },
  elements: {
    cardBox: { width: 'min(440px, 100%)', backgroundColor: '#fffdf7', border: '1px solid #ded6c4', borderRadius: '18px' },
    headerTitle: { color: '#283348' },
    headerSubtitle: { color: '#536172' },
    formFieldLabel: { color: '#283348' },
    socialButtonsBlockButtonText: { color: '#283348' },
    footerActionLink: { color: '#a9482f' },
    footerActionText: { color: '#536172' },
    dividerText: { color: '#536172' },
    formButtonPrimary: { backgroundColor: '#bb593b', color: '#ffffff' },
    formFieldInput: { backgroundColor: '#ffffff', color: '#283348' },
  },
};

function AuthCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const last = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const id = user?.id ?? null;
    if (last.current !== undefined && last.current !== id) client.clear();
    last.current = id;
  }), [addListener, client]);
  return null;
}

function PublicHome() {
  return <div className="onboard">
    <div className="brand" style={{ width: 'fit-content' }}><span className="brand-mark">S</span> study coach<span style={{ color: '#dc6843' }}>.</span></div>
    <div className="onboard-hero">
      <span className="eyebrow">A STUDY SPACE THAT REMEMBERS</span>
      <h1 className="display">Learn it. Test it. Keep it.</h1>
      <p className="lead">Bring your course materials—or start without them. Study with a conversational tutor, practice what you missed, and pick up on another device with your own private account.</p>
    </div>
    <div className="row" style={{ flexWrap: 'wrap' }}>
      <Link className="btn btn-primary" href="/sign-up" data-testid="link-create-account">Create an account</Link>
      <Link className="btn btn-outline" href="/sign-in" data-testid="link-sign-in">Sign in</Link>
    </div>
    <p className="muted" style={{ marginTop: 28, maxWidth: 610 }}>For students age 13 and older. Your course files are private to your account. Before any material is sent to an external AI service, we ask for your permission.</p>
  </div>;
}

function Desk() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  if (!user) return null;
  return <AccountPage key={user.id} onClassic={() => setLocation('/classic/courses')} onSignOut={() => void signOut({ redirectUrl: basePath || '/' })} />;
}

function Classic() {
  return <><div className="notice" style={{ position: 'relative', zIndex: 50, borderRadius: 0 }}>The lecture desk and classic workspace use data saved in this browser, not your account. Account courses and materials do not appear here automatically. Do not use it on a shared device.
      <Link className="btn btn-outline" href="/desk" data-testid="link-back-account" style={{ marginLeft: 12 }}>Back to account</Link>
    </div><LegacyApp base={`${basePath}/classic`} /></>;
}

function AuthRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Continue your study session' } }, signUp: { start: { title: 'Your private study space', subtitle: 'Create an account to save progress across devices' } } }}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
  >
    <QueryClientProvider client={queryClient}>
      <AuthCacheInvalidator />
      <Switch>
        <Route path="/"><><Show when="signed-in"><Redirect to="/desk" /></Show><Show when="signed-out"><PublicHome /></Show></></Route>
        <Route path="/sign-in/*?"><div className="onboard" style={{ maxWidth: 480 }}><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div></Route>
        <Route path="/sign-up/*?"><div className="onboard" style={{ maxWidth: 480 }}><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div></Route>
        <Route path="/desk"><><Show when="signed-in"><Desk /></Show><Show when="signed-out"><Redirect to="/" /></Show></></Route>
        <Route path="/classic/*?"><><Show when="signed-in"><Classic /></Show><Show when="signed-out"><Redirect to="/" /></Show></></Route>
        <Route><PublicHome /></Route>
      </Switch>
    </QueryClientProvider>
  </ClerkProvider>;
}

export default function AuthRoot() {
  return <WouterRouter base={basePath}><AuthRoutes /></WouterRouter>;
}