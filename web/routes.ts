import { useEffect, useState } from 'react';

export const clinicPages: Record<string, string> = {
  dashboard: 'Overview',
  patients: 'Patients',
  appointments: 'Appointments',
  treatments: 'Treatments',
  billing: 'Billing & payments',
  doctors: 'Doctors',
  team: 'Team & branches',
  masters: 'Masters',
  reports: 'Reports',
  settings: 'Clinic settings',
  subscription: 'Subscription',
  support: 'Help & support',
};
export const adminPages: Record<string, string> = {
  platform: 'Platform overview',
  clinics: 'Clinics',
  plans: 'Subscription plans',
  subscriptions: 'Subscriptions',
  'saas-payments': 'SaaS invoices',
  'platform-support': 'Support',
  audit: 'Audit trail',
  settings: 'Platform settings',
};
export const publicPages: Record<string, { path: string; title: string }> = {
  home: { path: '/', title: 'Your clinic, beautifully connected' },
  login: { path: '/login', title: 'Log in' },
  signup: { path: '/signup', title: 'Register a clinic' },
  forgot: { path: '/forgot-password', title: 'Forgot password' },
  reset: { path: '/reset-password', title: 'Reset password' },
  verify: { path: '/verify-email', title: 'Verify email' },
  about: { path: '/about', title: 'About' },
  contact: { path: '/contact', title: 'Contact' },
  privacy: { path: '/privacy', title: 'Privacy & data ownership' },
  terms: { path: '/terms', title: 'Terms of service' },
};
export const patientTabs: Record<string, string> = {
  overview: 'Overview',
  'tooth-chart': 'Tooth chart',
  'treatment-plans': 'Treatment plans',
  billing: 'Billing',
  documents: 'Documents',
  prescriptions: 'Prescriptions',
  'follow-ups': 'Follow-ups',
};
export const masterPages: Record<string, string> = {
  specialities: 'Speciality master',
  'charge-groups': 'Charge group master',
  charges: 'Charge master',
};
export type PageRoute = {
  area: 'public' | 'clinic' | 'admin';
  screen: string;
  patientId?: string;
  appointmentDate?: string;
  doctorId?: string;
  tab?: string;
  title: string;
  next?: string;
  notFound?: boolean;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parsePageRoute(location: string): PageRoute {
  const url = new URL(location, 'https://dentaflow.invalid');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (url.origin !== 'https://dentaflow.invalid')
    return { area: 'public', screen: 'not-found', title: 'Page not found', notFound: true };
  const found = Object.entries(publicPages).find(([, page]) => page.path === path);
  if (found) {
    const [screen, page] = found;
    const next = url.searchParams.get('next') || undefined;
    return {
      area: 'public',
      screen,
      title:
        screen === 'home' && ['#features', '#pricing'].includes(url.hash)
          ? url.hash === '#features'
            ? 'Features'
            : 'Pricing'
          : page.title,
      next,
    };
  }
  const [, area, screen, detail, tab, extra] = path.split('/');
  if (
    area === 'clinic' &&
    screen === 'patients' &&
    detail &&
    uuid.test(detail) &&
    !extra &&
    (!tab || patientTabs[tab])
  ) {
    return {
      area,
      screen,
      patientId: detail,
      tab: tab || 'overview',
      title: `Patient record - ${patientTabs[tab || 'overview']}`,
    };
  }
  if (area === 'clinic' && screen === 'appointments' && /^\d{4}-\d{2}-\d{2}$/.test(detail || '') && !extra && (!tab || uuid.test(tab))) {
    const parsed = new Date(detail + 'T12:00:00Z');
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === detail)
      return { area, screen, appointmentDate: detail, doctorId: tab, title: tab ? 'Daily patient list' : 'Appointment roster' };
  }
  if (area === 'clinic' && screen === 'appointments' && detail === 'new' && !tab)
    return { area, screen, tab: 'new', title: 'Create appointment' };
  if (area === 'clinic' && screen === 'masters' && !tab && detail && masterPages[detail])
    return { area, screen, tab: detail, title: masterPages[detail] };
  const pages = area === 'clinic' ? clinicPages : area === 'admin' ? adminPages : {};
  if (!detail && pages[screen])
    return { area: area as 'clinic' | 'admin', screen, title: pages[screen] };
  return { area: 'public', screen: 'not-found', title: 'Page not found', notFound: true };
}
export function workspacePath(area: string, screen: string) {
  return `/${area}/${screen}${area === 'clinic' && screen === 'masters' ? '/specialities' : ''}`;
}
export function loginDestination(next: string | undefined, user: any) {
  if (next?.startsWith('/') && !next.startsWith('//')) {
    const route = parsePageRoute(next);
    if (
      !route.notFound &&
      ((route.area === 'clinic' && user.tenantId) || (route.area === 'admin' && user.platformAdmin))
    )
      return next;
  }
  return user.platformAdmin && !user.tenantId ? '/admin/platform' : '/clinic/dashboard';
}
export function usePageRoute() {
  const current = () => window.location.pathname + window.location.search + window.location.hash;
  const [location, setLocation] = useState(current);
  useEffect(() => {
    const update = () => setLocation(current());
    window.addEventListener('popstate', update);
    window.addEventListener('hashchange', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('hashchange', update);
    };
  }, []);
  const go = (path: string, replace = false) => {
    if (path === current()) return;
    window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    setLocation(current());
  };
  return { route: parsePageRoute(location), location, go };
}
