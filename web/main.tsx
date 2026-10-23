import { DentalVisit, ReferralInbox } from './dental-workflow';
import { AppointmentCalendar } from './appointment-calendar';
import { Reception } from './reception';
import { AppointmentCreate } from './appointment-create';
import { usePageRoute, workspacePath, publicPages, patientTabs, loginDestination } from './routes';
import { ClinicMasters } from './masters';
import { Accounts } from './accounts';
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileText,
  HeartPulse,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Smile,
  Sparkles,
  Stethoscope,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { api, money, day, initials } from './api';
import './style.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import './accessibility.css';

type Field = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  value?: any;
  hint?: string;
  updates?: Record<string, Record<string, any>>;
};
type Modal = {
  title: string;
  subtitle?: string;
  fields: Field[];
  submit: (data: any) => Promise<any>;
  button?: string;
};
const clinicNav = [
  ['dashboard', 'Overview', LayoutDashboard],
  ['patients', 'Patients', Users],
  ['appointments', 'Appointments', CalendarDays],
  ['reception', 'Reception', Wallet],
  ['referrals', 'Internal referrals', ArrowRight],
  ['treatments', 'Treatments', HeartPulse],
  ['billing', 'Billing & payments', Wallet],
  ['accounts', 'Accounts', CreditCard],
  ['doctors', 'Doctors', Stethoscope],
  ['team', 'Team & branches', Building2],
  ['masters', 'Masters', ClipboardList],
  ['reports', 'Reports', TrendingUp],
] as const;
const screenCaps: Record<string, string> = {
  dashboard: 'dashboard',
  patients: 'patients',
  appointments: 'appointments',
  reception: 'billing',
  referrals: 'appointments',
  treatments: 'clinical',
  billing: 'billing',
  accounts: 'reports',
  doctors: 'doctors',
  team: 'staff',
  masters: 'catalog',
  reports: 'reports',
  settings: 'settings',
  subscription: 'settings',
  support: 'settings',
};
function can(workspace: any, capability: string) {
  return (
    workspace?.capabilities?.includes(capability) ?? ['OWNER', 'MANAGER'].includes(workspace?.role)
  );
}
const panelNames: Record<string, string> = {
  BRANCH_ADMIN: 'Branch admin panel',
  RECEPTIONIST: 'Receptionist panel',
  DOCTOR: 'Doctor panel',
  ACCOUNTANT: 'Accountant panel',
};
const adminNav = [
  ['platform', 'Platform overview', LayoutDashboard],
  ['clinics', 'Clinics', Building2],
  ['plans', 'Subscription plans', ClipboardList],
  ['subscriptions', 'Subscriptions', CreditCard],
  ['saas-payments', 'SaaS invoices', Wallet],
  ['platform-support', 'Support', LifeBuoy],
  ['audit', 'Audit trail', ShieldCheck],
] as const;
const statuses: Record<string, string> = {
  SCHEDULED: 'Scheduled',
  ABSENT: 'Absent',
  CHECKED_IN: 'Checked in',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  PROPOSED: 'Proposed',
  ACCEPTED: 'Accepted',
  PLANNED: 'Planned',
  IN_PROGRESS: 'In progress',
  PAID: 'Paid',
  UNPAID: 'Unpaid',
  PARTIAL: 'Part paid',
  ACTIVE: 'Active',
  TRIAL: 'Free trial',
  EXPIRED: 'Expired',
  SUSPENDED: 'Suspended',
  OPEN: 'Open',
  ACCRUED: 'Accrued',
  FAILED: 'Failed',
  PENDING: 'Pending',
};
function Badge({ value }: { value: string }) {
  return <span className={`badge ${value?.toLowerCase()}`}>{statuses[value] || value}</span>;
}
function Empty({
  title = 'Nothing here yet',
  text = 'Add your first record to get started.',
  action,
}: {
  title?: string;
  text?: string;
  action?: () => void;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <ClipboardList size={27} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="primary" onClick={action}>
          <Plus size={16} />
          Add a record
        </button>
      )}
    </div>
  );
}
function Metric({ label, value, detail, icon: Icon = Users, color = 'mint' }: any) {
  return (
    <div className="metric">
      <div className="metric-top">
        <span>{label}</span>
        <div className={`metric-icon ${color}`}>
          <Icon size={19} />
        </div>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function Logo({ name = 'DentaFlow' }: { name?: string }) {
  return (
    <span className="brand">
      <span className="brand-icon">
        <Smile size={23} />
      </span>
      {name === 'DentaFlow' ? (
        <>
          Denta<span>Flow</span>
        </>
      ) : (
        name
      )}
      <i>●</i>
    </span>
  );
}
function App() {
  const [me, setMe] = useState<any>(null),
    [ready, setReady] = useState(false),
    [workspace, setWorkspace] = useState<any>(null),
    [publicPlans, setPublicPlans] = useState<any[]>([]),
    [publicSettings, setPublicSettings] = useState<any>({}),
    [modal, setModal] = useState<Modal | null>(null),
    [toast, setToast] = useState(''),
    [error, setError] = useState(''),
    [tick, setTick] = useState(0),
    [mobile, setMobile] = useState(false),
    [search, setSearch] = useState(''),
    [patient, setPatientData] = useState<any>(null);
  const { route, location, go } = usePageRoute();
  const mode = route.area === 'admin' ? 'admin' : 'clinic';
  const screen = route.area === 'public' ? 'dashboard' : route.screen;
  const authScreen = route.area === 'public' ? route.screen : 'login';
  const setAuthScreen = (page: string) =>
    go(page === 'features' || page === 'pricing' ? `/#${page}` : publicPages[page]?.path || '/');
  const setPatient = (record: any) =>
    go(record ? `/clinic/patients/${record.id}` : '/clinic/patients');
  const refresh = () => setTick((t) => t + 1);
  const notify = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 5000);
  };
  const action = async (fn: () => Promise<any>, message = 'Saved successfully', options: { reportError?: boolean } = {}) => {
    try {
      const result = await fn();
      notify(message);
      refresh();
      return result;
    } catch (e: any) {
      if (options.reportError !== false) setError(e.message);
      throw e;
    }
  };
  useEffect(() => {
    Promise.all([
      api('/public/plans').then(setPublicPlans).catch(() => {}),
      api('/public/settings').then(setPublicSettings).catch(() => {}),
      api('/auth/me')
        .then((u) => {
          setMe(u);
        })
        .catch(() => {})
        .finally(() => setReady(true)),
    ]);
  }, []);
  useEffect(() => {
    if (me?.tenantId)
      api('/clinic/workspace')
        .then(setWorkspace)
        .catch((e) => setError(e.message));
  }, [me, tick]);
  const navigate = (s: string) => {
    if (mode === 'clinic' && screenCaps[s] && !can(workspace, screenCaps[s])) return;
    go(workspacePath(mode, s));
    setSearch('');
    setMobile(false);
    setError('');
  };
  const logout = () =>
    action(() => api('/auth/logout', 'POST', {}), 'Signed out')
      .then(() => {
        setMe(null);
        setWorkspace(null);
        go('/login');
      })
      .catch(() => {});
  const signedIn = async () => {
    const u = await api('/auth/me');
    setMe(u);
    go(!route.next && u.memberships?.find((m: any) => m.tenantId === u.tenantId)?.role === 'DOCTOR' ? '/clinic/appointments' : loginDestination(route.next, u), true);
  };
  useEffect(() => {
    if (!ready || route.notFound) return;
    if (!me && route.area !== 'public') go(`/login?next=${encodeURIComponent(location)}`, true);
    else if (me && route.area === 'public') go(loginDestination(route.next, me), true);
  }, [ready, me, location]);
  useEffect(() => {
    document.title = `${route.title} | DentaFlow`;
    if (window.location.hash)
      requestAnimationFrame(() =>
        document.getElementById(window.location.hash.slice(1))?.scrollIntoView(),
      );
  }, [location, ready]);
  useEffect(() => {
    let active = true;
    setPatientData(null);
    setError('');
    setModal(null);
    if (me && workspace && route.patientId && can(workspace, 'patients')) {
      api(`/clinic/patients/${route.patientId}`)
        .then((p) => {
          if (active) setPatientData(p);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }
    return () => {
      active = false;
    };
  }, [route.patientId, me, workspace?.role, workspace?.branchId, workspace?.doctorId]);
  useEffect(() => {
    setModal(null);
    setError('');
    setMobile(false);
  }, [location]);
  const patientCapability =
    route.patientId && route.tab && route.tab !== 'overview'
      ? route.tab === 'billing'
        ? 'billing'
        : route.tab === 'documents'
          ? 'documents'
          : route.tab === 'follow-ups'
            ? 'patients'
            : 'clinical'
      : 'patients';
  currentWorkspace = workspace;
  const common = {
    modal: setModal,
    action,
    notify,
    tick,
    workspace,
    search,
    setPatient,
    navigate,
    route,
    go,
  };
  if (!ready)
    return (
      <div className="loading-page">
        <Logo />
        <p>Preparing your workspace…</p>
      </div>
    );
  return (
    <>
      {route.notFound ? (
        <div className="loading-page">
          <Logo />
          <h1>Page not found</h1>
          <button
            className="primary"
            onClick={() => go(me ? loginDestination(undefined, me) : '/')}
          >
            Go home
          </button>
        </div>
      ) : !me ? (
        <PublicSite
          plans={publicPlans}
          settings={publicSettings}
          screen={authScreen}
          setScreen={setAuthScreen}
          signedIn={signedIn}
        />
      ) : (
        <div className="app-shell">
          {mobile && <div className="scrim" onClick={() => setMobile(false)} />}
          <aside className={`sidebar ${mobile ? 'open' : ''}`}>
            <Logo />
            <div className="workspace-box">
              <div className="workspace-symbol">
                {mode === 'clinic' &&
                workspace?.tenant.settings?.logoUrl &&
                workspace?.subscription?.plan.features?.customBranding ? (
                  <img src={workspace.tenant.settings.logoUrl} alt="Clinic logo" />
                ) : (
                  <Building2 size={20} />
                )}
              </div>
              <div>
                <strong>
                  {mode === 'admin'
                    ? 'Platform workspace'
                    : workspace?.tenant?.name || 'Clinic workspace'}
                </strong>
                <small>{mode === 'admin' ? 'SaaS administration' : 'Your care. Connected.'}</small>
              </div>
            </div>
            <p className="nav-label">{mode === 'admin' ? 'PLATFORM' : 'CLINIC WORKSPACE'}</p>
            <nav>
              {(mode === 'admin'
                ? adminNav
                : clinicNav.filter(([key]) => can(workspace, screenCaps[key]) && (key !== 'reception' || can(workspace, 'appointments')))
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  className={screen === key ? 'active' : ''}
                  onClick={() => navigate(key)}
                >
                  <Icon size={19} />
                  {label}
                  {key === 'appointments' && <span className="nav-dot" />}
                </button>
              ))}
            </nav>
            <div className="nav-bottom">
              <p className="nav-label">MANAGE</p>
              {mode === 'clinic' && can(workspace, 'settings') && (
                <>
                  <button
                    className={screen === 'subscription' ? 'active' : ''}
                    onClick={() => navigate('subscription')}
                  >
                    <CreditCard size={19} />
                    Subscription
                  </button>
                  <button
                    className={screen === 'support' ? 'active' : ''}
                    onClick={() => navigate('support')}
                  >
                    <LifeBuoy size={19} />
                    Help & support
                  </button>
                </>
              )}
              {(mode === 'admin' || can(workspace, 'settings')) && (
                <button
                  className={screen === 'settings' ? 'active' : ''}
                  onClick={() => navigate('settings')}
                >
                  <Settings size={19} />
                  Settings
                </button>
              )}
              {me.platformAdmin && (
                <button
                  onClick={() => {
                    go(mode === 'admin' ? '/clinic/dashboard' : '/admin/platform');
                  }}
                >
                  <ShieldCheck size={19} />
                  {mode === 'admin' ? 'Clinic workspace' : 'Platform admin'}
                </button>
              )}
              {mode === 'clinic' &&
                can(workspace, 'settings') &&
                workspace?.subscription?.status === 'TRIAL' && (
                  <div className="trial-card">
                    <Sparkles size={19} />
                    <strong>A little more room to grow</strong>
                    <p>Your free trial ends {day(workspace.subscription.endsAt)}.</p>
                    <button onClick={() => navigate('subscription')}>
                      Explore plans <ArrowUpRight size={14} />
                    </button>
                  </div>
                )}
              <button className="profile" onClick={logout}>
                <span className="avatar">{initials(me.name)}</span>
                <div>
                  <strong>{me.name}</strong>
                  <small>
                    {mode === 'admin' ? 'Platform admin' : workspace?.role || 'Clinic team'}
                  </small>
                </div>
                <LogOut size={16} />
              </button>
            </div>
          </aside>
          <main className="main">
            <header className="topbar">
              <div className="breadcrumb">
                <button
                  className="icon-button mobile-menu"
                  onClick={() => setMobile(true)}
                  aria-label="Open menu"
                >
                  <Menu size={21} />
                </button>
                <span>{mode === 'admin' ? 'Platform' : 'Workspace'}</span>
                <ChevronRight size={14} />
                <strong>
                  {patient
                    ? 'Patient record'
                    : (mode === 'admin' ? adminNav : clinicNav).find((n) => n[0] === screen)?.[1] ||
                      screen.charAt(0).toUpperCase() + screen.slice(1)}
                </strong>
              </div>
              <div className="top-actions">
                <form
                  className="top-search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (mode === 'clinic' && can(workspace, 'patients')) go('/clinic/patients');
                    else if (mode === 'admin') go('/admin/clinics');
                  }}
                >
                  <Search size={17} />
                  <input
                    placeholder={mode === 'admin' ? 'Search clinics…' : 'Search patients…'}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <kbd>↵</kbd>
                </form>
                <button
                  className="icon-button"
                  aria-label="View support requests"
                  onClick={() => navigate(mode === 'admin' ? 'platform-support' : 'support')}
                >
                  <Bell size={19} />
                  <span className="notification-dot" />
                </button>
                <span className="top-avatar">{initials(me.name)}</span>
              </div>
            </header>
            <div className="content">
              {error && (
                <div role="alert" className="error-banner">
                  {error}
                  <button aria-label="Dismiss error" onClick={() => setError('')}>
                    <X size={16} />
                  </button>
                </div>
              )}
              {(mode === 'admin' && !me.platformAdmin) ||
              (mode === 'clinic' &&
                workspace &&
                (!can(workspace, screenCaps[screen] || 'dashboard') ||
                  (route.patientId && !can(workspace, patientCapability)))) ? (
                <section className="panel panel-body">
                  <h1>Access restricted</h1>
                  <p>Your role does not permit this page.</p>
                </section>
              ) : mode === 'admin' ? (
                <Admin screen={screen} {...common} />
              ) : route.patientId && (!patient || patient.id !== route.patientId) ? (
                <DataError error={error} />
              ) : route.patientId && patient ? (
                <PatientDetail patient={patient} back={() => setPatient(null)} {...common} />
              ) : screen === 'dashboard' ? (
                workspace?.role === 'RECEPTIONIST' ? <Reception {...common} /> : <Dashboard {...common} navigate={navigate} name={me.name} />
              ) : screen === 'reception' ? (
                <Reception {...common} />
              ) : screen === 'patients' ? (
                <Patients {...common} />
              ) : screen === 'appointments' ? (
                route.tab === 'new' ? <AppointmentCreate {...common} /> : route.tab === 'visit' ? <DentalVisit {...common} /> : <AppointmentCalendar {...common} />
              ) : screen === 'referrals' ? (
                <ReferralInbox {...common} />
              ) : screen === 'treatments' ? (
                <Treatments {...common} />
              ) : screen === 'billing' ? (
                <Billing {...common} />
              ) : screen === 'doctors' ? (
                <Doctors {...common} />
              ) : screen === 'team' ? (
                <Team {...common} />
              ) : screen === 'masters' ? (
                <ClinicMasters {...common} />
              ) : screen === 'accounts' ? (
                <Accounts {...common} />
              ) : screen === 'reports' ? (
                <Reports {...common} />
              ) : screen === 'settings' ? (
                <ClinicSettings {...common} />
              ) : screen === 'subscription' ? (
                <Subscription {...common} />
              ) : screen === 'support' ? (
                <Support {...common} />
              ) : null}
            </div>
            <footer className="app-footer">
              <span>
                <span className="live-dot" /> Your clinic data stays in your workspace
              </span>
              <span>DentaFlow · Made for better care</span>
            </footer>
          </main>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={20} />
          {toast}
        </div>
      )}
      {modal && (
        <FormModal modal={modal} close={() => setModal(null)} notify={notify} refresh={refresh} />
      )}
    </>
  );
}
function useData(url: string, tick: number) {
  const [result, setResult] = useState<{ url: string; value: any } | null>(null),
    [failure, setFailure] = useState<{ url: string; message: string } | null>(null);
  useEffect(() => {
    let active = true;
    setFailure(null);
    if (!url) return;
    api(url)
      .then((d) => {
        if (active) setResult({ url, value: d });
      })
      .catch((e) => {
        if (active) {
          setResult(null);
          setFailure({ url, message: e.message });
        }
      });
    return () => {
      active = false;
    };
  }, [url, tick]);
  return {
    data: result?.url === url ? result.value : null,
    error: failure?.url === url ? failure.message : '',
  };
}
function DataError({ error }: any) {
  return error ? (
    <div className="error-banner">{error}</div>
  ) : (
    <p className="muted loading">Loading your clinic data…</p>
  );
}
function PageTitle({ eyebrow, title, subtitle, children }: any) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
function Dashboard({ tick, modal, action, navigate, name, workspace }: any) {
  const { data: d, error } = useData('/clinic/overview', tick);
  if (!d) return <DataError error={error} />;
  const complete = d.appointments.filter((a: any) => a.status === 'COMPLETED').length;
  const waiting = d.appointments.filter((a: any) => a.status === 'CHECKED_IN').length;
  return (
    <>
      <PageTitle
        eyebrow="LET’S MAKE EVERY SMILE COUNT"
        title={
          panelNames[workspace?.role] ||
          `Welcome back, ${name.replace(/^Dr\.\s*/, '').split(' ')[0]}`
        }
        subtitle="A clear view of your clinic, so you can focus on care."
      >
        <span className="date-pill">
          <CalendarDays size={17} />
          {new Intl.DateTimeFormat('en-IN', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }).format(new Date())}
        </span>
        <button className="primary" onClick={() => appointmentModal(modal, action)}>
          <Plus size={17} />
          New appointment
        </button>
      </PageTitle>
      <div className="metrics">
        <Metric
          label="Total patients"
          value={d.patients.toLocaleString('en-IN')}
          detail="People who trust you with their smile"
          icon={Users}
        />
        <Metric
          label="Appointments today"
          value={String(d.appointments.length).padStart(2, '0')}
          detail={`${complete} completed · ${waiting} checked in`}
          icon={CalendarDays}
          color="peach"
        />
        {can(workspace, 'billing') && (
          <Metric
            label="Patient collections"
            value={money(d.collectionsPaise)}
            detail="All recorded patient payments"
            icon={Wallet}
            color="blue"
          />
        )}
        {can(workspace, 'billing') && (
          <Metric
            label="Outstanding balance"
            value={money(d.outstandingPaise)}
            detail="Across open patient invoices"
            icon={CreditCard}
            color="lavender"
          />
        )}
      </div>
      <div className="dashboard-grid">
        <section className="panel schedule">
          <div className="panel-heading">
            <div>
              <h2>
                Today’s appointments <span className="count-pill">{d.appointments.length}</span>
              </h2>
              <p>Your day, thoughtfully organized.</p>
            </div>
            <button className="text-button" onClick={() => navigate('appointments')}>
              View all <ArrowRight size={16} />
            </button>
          </div>
          <div className="schedule-label">
            <span>TIME / PATIENT</span>
            <span>TREATMENT</span>
            <span>STATUS</span>
          </div>
          {d.appointments.length ? (
            d.appointments.map((a: any) => (
              <div className="appointment-row" key={a.id}>
                <div className="time-block">
                  <strong>
                    {new Intl.DateTimeFormat('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: workspace?.tenant.settings?.timezone || 'Asia/Kolkata',
                    }).format(new Date(a.startsAt))}
                  </strong>
                  <small>{a.durationMinutes} min</small>
                </div>
                <span className={`avatar tone-${a.patientName.length % 4}`}>
                  {initials(a.patientName)}
                </span>
                <div className="appointment-person">
                  <strong>{a.patientName}</strong>
                  <small>{a.doctorName}</small>
                </div>
                <div className="appointment-treatment">{a.reason}</div>
                <Badge value={a.status} />
                <button
                  className="icon-button"
                  aria-label={`Update appointment for ${a.patientName}`}
                  onClick={() =>
                    modal({
                      title: 'Update appointment',
                      fields: [
                        {
                          key: 'status',
                          label: 'Status',
                          type: 'select',
                          value: a.status,
                          options: ['SCHEDULED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED'].map(
                            (value) => ({ value, label: statuses[value] }),
                          ),
                        },
                      ],
                      submit: (data: any) =>
                        action(() => api(`/clinic/appointments/${a.id}`, 'PATCH', data)),
                    })
                  }
                >
                  <MoreHorizontal size={19} />
                </button>
              </div>
            ))
          ) : (
            <Empty
              title="A little breathing room"
              text="No appointments scheduled today."
              action={() => appointmentModal(modal, action)}
            />
          )}
        </section>
        <section className="panel day-card">
          <div className="panel-heading">
            <div>
              <h2>Your day at a glance</h2>
              <p>Every visit is a step toward a healthier smile.</p>
            </div>
          </div>
          <div
            className="donut"
            style={{
              background: `conic-gradient(#287c6e 0 ${(complete / (d.appointments.length || 1)) * 360}deg,#efd7b4 ${(complete / (d.appointments.length || 1)) * 360}deg 360deg)`,
            }}
          >
            <div>
              <strong>{d.appointments.length}</strong>
              <small>appointments</small>
            </div>
          </div>
          <div className="legend">
            <span>
              <i className="dot teal" />
              Completed<strong>{complete}</strong>
            </span>
            <span>
              <i className="dot peach" />
              Checked in<strong>{waiting}</strong>
            </span>
            <span>
              <i className="dot light" />
              Upcoming
              <strong>{d.appointments.filter((a: any) => a.status === 'SCHEDULED').length}</strong>
            </span>
          </div>
          <div className="care-note">
            <HeartPulse size={19} />
            <span>A well-planned day makes room for better care.</span>
          </div>
        </section>
        <section className="panel quick-panel">
          <div className="panel-heading">
            <div>
              <h2>A little less admin. A little more care.</h2>
              <p>Your everyday essentials, one click away.</p>
            </div>
            <Sparkles size={22} />
          </div>
          <div className="quick-actions">
            {[
              [
                Users,
                'Add a patient',
                'Start a new patient record',
                () => patientModal(modal, action),
              ],
              [
                FileText,
                'Create an invoice',
                'Keep billing simple',
                () => invoiceModal(modal, action),
              ],
              [
                Stethoscope,
                'Manage doctors',
                'Bring your care team together',
                () => navigate('doctors'),
              ],
              [
                TrendingUp,
                'View reports',
                'Understand your clinic’s progress',
                () => navigate('reports'),
              ],
            ]
              .filter(([, label]) =>
                can(
                  workspace,
                  (
                    {
                      'Add a patient': 'patients',
                      'Create an invoice': 'billing',
                      'Manage doctors': 'doctors',
                      'View reports': 'reports',
                    } as any
                  )[String(label)],
                ),
              )
              .map(([Icon, label, desc, fn]: any) => (
                <button key={label} onClick={fn}>
                  <span className="quick-icon">
                    <Icon size={20} />
                  </span>
                  <strong>{label}</strong>
                  <small>{desc}</small>
                  <ArrowUpRight size={17} />
                </button>
              ))}
          </div>
        </section>
        <section className="panel followup-panel">
          <div className="panel-heading">
            <div>
              <h2>Follow-ups</h2>
              <p>Good care continues after the visit.</p>
            </div>
            <button className="text-button" onClick={() => navigate('patients')}>
              View patients <ArrowRight size={16} />
            </button>
          </div>
          {d.followups.length ? (
            d.followups.map((f: any) => (
              <div className="followup-row" key={f.id}>
                <span className="small-icon">
                  <CalendarDays size={16} />
                </span>
                <div>
                  <strong>{f.title}</strong>
                  <small>Due {day(f.dueAt)}</small>
                </div>
                <button
                  className="secondary small"
                  onClick={() =>
                    action(() =>
                      api(`/clinic/followups/${f.id}`, 'PATCH', { status: 'DONE' }),
                    ).catch(() => {})
                  }
                >
                  Mark done
                </button>
              </div>
            ))
          ) : (
            <div className="quiet-empty">
              <CheckCircle2 size={24} />
              <strong>You’re all caught up</strong>
              <p>Patient follow-ups will appear here.</p>
            </div>
          )}
        </section>
      </div>
      {can(workspace, 'settings') && workspace?.tenant.onboarding !== 'COMPLETE' && (
        <Onboarding navigate={navigate} action={action} d={d} />
      )}
    </>
  );
}
function Onboarding({ navigate, action, d }: any) {
  return (
    <section className="onboarding">
      <span className="onboarding-icon">
        <Sparkles size={23} />
      </span>
      <div>
        <h3>Make DentaFlow your own</h3>
        <p>Set up your team, treatment pricing and clinic details.</p>
      </div>
      <div className="setup-steps">
        <button onClick={() => navigate('doctors')}>
          {d.doctors > 0 ? <Check size={14} /> : <Plus size={14} />}Add doctors
        </button>
        <button onClick={() => navigate('settings')}>Clinic & pricing</button>
        <button onClick={() => navigate('team')}>Invite staff</button>
        <button
          className="primary small"
          onClick={() =>
            action(
              () => api('/clinic/settings', 'PATCH', { onboarding: 'COMPLETE' }),
              'Onboarding complete',
            ).catch(() => {})
          }
        >
          Finish setup <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}
async function patientModal(modal: any, action: any, existing?: any) {
  const [branches, doctors] = await Promise.all([api('/clinic/branches'), api('/clinic/doctors')]);
  modal({
    title: existing ? 'Edit patient' : 'Add a new patient',
    subtitle: 'A good relationship starts with the right details.',
    fields: [
      { key: 'name', label: 'Full name', required: true, value: existing?.name },
      {
        key: 'branchId',
        label: 'Branch',
        type: 'select',
        value: existing?.branchId || currentWorkspace?.branchId || '',
        options: [
          { value: '', label: 'Unassigned' },
          ...branches
            .filter((b: any) => b.active)
            .map((b: any) => ({ value: b.id, label: b.name })),
        ],
      },
      {
        key: 'doctorId',
        label: 'Assigned doctor',
        type: 'select',
        value: existing?.doctorId || currentWorkspace?.doctorId || '',
        options: [
          { value: '', label: 'Unassigned' },
          ...doctors.filter((d: any) => d.active).map((d: any) => ({ value: d.id, label: d.name })),
        ],
      },
      { key: 'phone', label: 'Phone number', required: true, value: existing?.phone },
      { key: 'email', label: 'Email', type: 'email', value: existing?.email },
      {
        key: 'gender',
        label: 'Gender',
        type: 'select',
        value: existing?.gender || 'Unspecified',
        options: ['Female', 'Male', 'Other', 'Unspecified'].map((value) => ({
          value,
          label: value,
        })),
      },
      { key: 'address', label: 'Address', value: existing?.address },
      { key: 'allergies', label: 'Allergies', value: existing?.allergies },
      {
        key: 'medicalHistory',
        label: 'Medical history',
        type: 'textarea',
        value: existing?.medicalHistory,
      },
      {
        key: 'consent',
        label: 'Patient consent recorded',
        type: 'checkbox',
        value: existing?.consent,
      },
    ],
    submit: (data: any) =>
      action(() =>
        api(
          existing ? `/clinic/patients/${existing.id}` : '/clinic/patients',
          existing ? 'PATCH' : 'POST',
          data,
        ),
      ),
  });
}
async function options(resource: string, label = 'name') {
  const rows = await api(`/clinic/${resource}`);
  return rows
    .filter((r: any) => r.active !== false)
    .map((r: any) => ({ value: r.id, label: r[label] }));
}
function appointmentModal(_modal: any, _action: any, patientId?: string) {
  window.history.pushState({}, '', '/clinic/appointments/new' + (patientId ? '?patientId=' + patientId : ''));
  window.dispatchEvent(new PopStateEvent('popstate'));
}
async function invoiceModal(modal: any, action: any, patientId?: string) {
  const patients = await options('patients');
  modal({
    title: 'Create a patient invoice',
    subtitle: 'Amounts are in rupees. Patient payments are separate from your subscription.',
    fields: [
      {
        key: 'patientId',
        label: 'Patient',
        type: 'select',
        options: patients,
        value: patientId,
        required: true,
      },
      { key: 'description', label: 'Description', required: true },
      { key: 'totalPaise', label: 'Invoice total (₹)', type: 'money', required: true },
      { key: 'dueAt', label: 'Due date', type: 'datetime-local' },
    ],
    submit: (data: any) => action(() => api('/clinic/invoices', 'POST', data)),
  });
}
function payModal(modal: any, action: any, invoice: any) {
  const key = crypto.randomUUID();
  modal({
    title: 'Record an installment',
    subtitle: `${invoice.description} · Balance ${money(invoice.totalPaise - invoice.paidPaise)}`,
    fields: [
      {
        key: 'amountPaise',
        label: 'Amount received (₹)',
        type: 'money',
        value: (invoice.totalPaise - invoice.paidPaise) / 100,
        required: true,
      },
      {
        key: 'method',
        label: 'Payment method',
        type: 'select',
        options: ['CASH', 'UPI', 'CARD', 'BANK'].map((value) => ({ value, label: value })),
      },
      { key: 'reference', label: 'Transaction reference' },
    ],
    submit: (data: any) =>
      action(
        () =>
          api('/clinic/payments', 'POST', { ...data, invoiceId: invoice.id, idempotencyKey: key }),
        'Payment recorded',
      ),
  });
}
function Patients(props: any) {
  const { tick, modal, action, search, setPatient } = props;
  const { data, error } = useData(`/clinic/patients?q=${encodeURIComponent(search)}`, tick);
  return (
    <>
      <PageTitle title="Patients" subtitle="Every smile has a story. Keep it all in one place.">
        <button className="primary" onClick={() => patientModal(modal, action)}>
          <Plus size={17} />
          Add patient
        </button>
      </PageTitle>
      <section className="panel">
        <div className="panel-heading">
          <h2>
            Patient directory <span className="count-pill">{data?.length || 0}</span>
          </h2>
          <span className="muted">Search patients from the top bar</span>
        </div>
        {!data ? (
          <DataError error={error} />
        ) : !data.length ? (
          <Empty
            title="Your next smile starts here"
            text="Add your first patient to begin their care journey."
            action={() => patientModal(modal, action)}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Phone</th>
                  <th>Gender</th>
                  <th>Added</th>
                  <th>Record</th>
                </tr>
              </thead>
              <tbody>
                {data.map((p: any) => (
                  <tr key={p.id}>
                    <td>
                      <div className="person-cell">
                        <span className={`avatar tone-${p.name.length % 4}`}>
                          {initials(p.name)}
                        </span>
                        <div>
                          <strong>{p.name}</strong>
                          <small>{p.email || 'No email provided'}</small>
                        </div>
                      </div>
                    </td>
                    <td>{p.phone}</td>
                    <td>{p.gender}</td>
                    <td>{day(p.createdAt)}</td>
                    <td>
                      <button className="text-button" onClick={() => setPatient(p)}>
                        Open record <ArrowUpRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
function Billing({ tick, modal, action }: any) {
  const { data, error } = useData('/clinic/invoices', tick);
  const { data: patients } = useData('/clinic/patients', tick);
  const { data: payments } = useData('/clinic/payments', tick);
  return (
    <>
      <PageTitle
        title="Billing & payments"
        subtitle="Clear invoices. Flexible installments. Happier patients."
      >
        <button className="primary" onClick={() => invoiceModal(modal, action)}>
          <Plus size={17} />
          Create invoice
        </button>
      </PageTitle>
      <div className="metrics three">
        <Metric
          label="Total invoiced"
          value={money(data?.reduce((s: number, i: any) => s + i.totalPaise, 0))}
          detail="Patient treatment & consultation fees"
          icon={FileText}
        />
        <Metric
          label="Collected"
          value={money(data?.reduce((s: number, i: any) => s + i.paidPaise, 0))}
          detail={`${payments?.length || 0} recorded payments`}
          icon={Wallet}
          color="blue"
        />
        <Metric
          label="Outstanding"
          value={money(data?.reduce((s: number, i: any) => s + i.totalPaise - i.paidPaise, 0))}
          detail="Installments still to be received"
          icon={CreditCard}
          color="peach"
        />
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Patient invoices</h2>
          <span className="muted">Clinic ledger</span>
        </div>
        {!data ? (
          <DataError error={error} />
        ) : !data.length ? (
          <Empty action={() => invoiceModal(modal, action)} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Patient / invoice</th>
                  <th>Total</th>
                  <th>Paid</th>
                  <th>Balance</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.map((i: any) => (
                  <tr key={i.id}>
                    <td>
                      <strong>
                        {patients?.find((p: any) => p.id === i.patientId)?.name || 'Patient'}
                      </strong>
                      <small>{i.description}</small>
                    </td>
                    <td>{money(i.totalPaise)}</td>
                    <td>{money(i.paidPaise)}</td>
                    <td>{money(i.totalPaise - i.paidPaise)}</td>
                    <td>
                      <Badge value={i.status} />
                    </td>
                    <td>
                      {i.status !== 'PAID' && (
                        <button
                          className="secondary small"
                          onClick={() => payModal(modal, action, i)}
                        >
                          Record payment
                        </button>
                      )}
                      <button
                        className="text-button"
                        onClick={() =>
                          printInvoice(
                            i,
                            workspaceSafe(),
                            patients?.find((p: any) => p.id === i.patientId),
                            payments?.filter((p: any) => p.invoiceId === i.id),
                          )
                        }
                      >
                        <FileText size={15} />
                        Print
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel section-gap">
        <div className="panel-heading">
          <h2>Payment receipts</h2>
        </div>
        {payments?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Date</th>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p: any) => (
                  <tr key={p.id}>
                    <td>{p.id.slice(0, 8).toUpperCase()}</td>
                    <td>{day(p.createdAt)}</td>
                    <td>{p.method}</td>
                    <td>{money(p.amountPaise)}</td>
                    <td>{p.reference || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Payments will appear here"
            text="Record an installment against an invoice to create a receipt."
          />
        )}
      </section>
    </>
  );
}
let currentWorkspace: any = null;
function workspaceSafe() {
  return currentWorkspace;
}
function printInvoice(i: any, w: any, p: any, payments: any[] = []) {
  const escape = (s: any) =>
    String(s || '').replace(
      /[&<>"']/g,
      (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    );
  const popup = window.open('', '_blank');
  if (!popup) return;
  popup.document.write(
    `<html><head><title>Patient invoice</title><style>body{font:15px system-ui;padding:40px;color:#183e39}h1{font-size:26px}table{width:100%;border-collapse:collapse;margin:30px 0}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left}small{color:#666}</style></head><body><h1>${escape(w?.tenant.name || 'Dental clinic')}</h1><p>${escape(w?.tenant.settings?.address)}</p><p>${escape(w?.tenant.settings?.invoiceHeader)}</p><h2>Patient invoice · ${escape(i.id.slice(0, 8))}</h2><p>${escape(p?.name)} · ${escape(p?.phone)}<br>${escape(day(i.createdAt))}</p><table><tr><th>Description</th><th>Total</th><th>Paid</th><th>Balance</th></tr><tr><td>${escape(i.description)}</td><td>${money(i.totalPaise)}</td><td>${money(i.paidPaise)}</td><td>${money(i.totalPaise - i.paidPaise)}</td></tr></table><h3>Payment receipts</h3>${payments.map((r) => `<p>${escape(day(r.createdAt))} · ${escape(r.method)} · ${money(r.amountPaise)} · ${escape(r.reference)}<br><small>Receipt ${escape(r.id)}</small></p>`).join('')}<p>${escape(w?.tenant.settings?.invoiceFooter || 'Thank you for your trust.')}</p></body></html>`,
  );
  popup.document.close();
  popup.print();
}
function Doctors({ tick, modal, action, notify, workspace }: any) {
  const { data: doctorLogins } = useData('/clinic/staff', tick);
  const { data: branches } = useData('/clinic/branches', tick);
  const branchField = (d?: any): Field => ({
    key: 'branchIds',
    label: 'Available branches',
    type: 'multiselect',
    value: d?.branchIds?.length ? d.branchIds : d?.branchId ? [d.branchId] : currentWorkspace?.branchId ? [currentWorkspace.branchId] : [],
    hint: 'Select one or more branches. Hold Ctrl to select multiple branches.',
    options: [
      ...(branches || [])
        .filter((b: any) => b.active || d?.branchIds?.includes(b.id) || d?.branchId === b.id)
        .map((b: any) => ({ value: b.id, label: b.name })),
    ],
  });
  const { data, error } = useData('/clinic/doctors', tick);
  const { data: commissions } = useData('/clinic/commissions', tick);
  const { data: specialities } = useData('/clinic/specialities', tick);
  const specialityField = (doctor?: any): Field => ({
    key: 'specialityId',
    label: 'Speciality',
    type: 'select',
    required: !doctor?.specialty,
    value: doctor?.specialityId || '',
    options: [
      { value: '', label: doctor?.specialty || 'Choose speciality' },
      ...(specialities || [])
        .filter((row: any) => row.active || row.id === doctor?.specialityId)
        .map((row: any) => ({ value: row.id, label: row.name })),
    ],
    hint: 'Manage available specialities in Masters.',
  });
  const add = () =>
    modal({
      title: 'Add a doctor',
      fields: [
        { key: 'name', label: 'Full name', required: true },
        specialityField(),
        { key: 'qualification', label: 'Qualification (BDS / MDS)' },
        branchField(),
        { key: 'registrationNumber', label: 'Dental council registration' },
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'phone', label: 'Phone' },
        {
          key: 'consultationPaise',
          label: 'Consultant doctor fee (₹)',
          type: 'money',
          value: 300,
          required: true,
        },
        { key: 'visitingConsultationPaise', label: 'Visiting consultant doctor fee (₹)', type: 'money', value: 1000, required: true },
        {
          key: 'commissionPercent',
          label: 'Commission (%) on collections',
          type: 'number',
          value: 40,
          required: true,
        },
      ],
      submit: (d: any) => action(() => api('/clinic/doctors', 'POST', d)),
    });
  return (
    <>
      <PageTitle title="Your care team" subtitle="Great care starts with great people.">
        <button className="primary" onClick={add} disabled={!specialities || !branches}>
          <Plus size={17} />
          Add doctor
        </button>
      </PageTitle>
      {!data ? (
        <DataError error={error} />
      ) : !data.length ? (
        <section className="panel">
          <Empty title="Build your care team" action={add} />
        </section>
      ) : (
        <div className="doctor-grid">
          {data.map((d: any) => (
            <section className="panel doctor-card" key={d.id}>
              <div className="doctor-card-top">
                <span className="doctor-avatar">{initials(d.name.replace('Dr. ', ''))}</span>
                <Badge value={d.active ? 'ACTIVE' : 'Inactive'} />
              </div>
              <h2>{d.name}</h2>
              <p>
                {specialities?.find((row: any) => row.id === d.specialityId)?.name || d.specialty}
              </p>
              <small>{d.registrationNumber || 'Registration not recorded'}</small>
              {d.qualification && <p>{d.qualification}</p>}
              <p>{doctorLogins?.find((m: any) => m.doctorId === d.id && m.active) ? 'Login: ' + doctorLogins.find((m: any) => m.doctorId === d.id && m.active).user.email : 'Login not configured'}</p>
              <div className="doctor-card-details">
                <span>
                  Consultant fee<strong>{money(d.consultationPaise)}</strong>
                </span>
                <span>Visiting consultant fee<strong>{money(d.visitingConsultationPaise)}</strong></span>
                <span>
                  Commission<strong>{d.commissionPercent}%</strong>
                </span>
              </div>
              <p>{(d.branchIds?.length ? d.branchIds : d.branchId ? [d.branchId] : []).map((id: string) => branches?.find((b: any) => b.id === id)?.name).filter(Boolean).join(' · ') || 'No branch assigned'}</p>
              <div className="doctor-actions">
                <button className="secondary small" onClick={async () => {
                  try {
                    const login = await api(`/clinic/doctors/${d.id}/login`);
                    modal({ title: login ? 'Update doctor login' : 'Create doctor login', subtitle: 'Each doctor signs in with their own email and password.', fields: [
                      { key: 'email', label: 'Login email', type: 'email', required: true, value: login?.user.email || d.email },
                      { key: 'password', label: 'Password (at least 12 characters)', type: 'password', required: true },
                      ...(workspace?.role !== 'BRANCH_ADMIN' ? [{ key: 'allDoctorBranches', label: 'Allow appointments across all assigned branches', type: 'checkbox', value: login?.allDoctorBranches ?? true }] : []),
                    ], submit: (fields: any) => action(() => api(`/clinic/doctors/${d.id}/login`, 'POST', fields), 'Doctor login saved') });
                  } catch (e: any) { notify(e.message); }
                }}>Manage login</button>
                <button
                  className="secondary small"
                  onClick={() =>
                    modal({
                      title: 'Edit doctor',
                      fields: [
                        { key: 'name', label: 'Name', value: d.name, required: true },
                        specialityField(d),
                        { key: 'qualification', label: 'Qualification (BDS / MDS)', value: d.qualification },
                        branchField(d),
                        {
                          key: 'consultationPaise',
                          label: 'Consultant doctor fee (₹)',
                          type: 'money',
                          value: d.consultationPaise / 100,
                        },
                        { key: 'visitingConsultationPaise', label: 'Visiting consultant doctor fee (₹)', type: 'money', value: (d.visitingConsultationPaise ?? 100000) / 100 },
                        {
                          key: 'commissionPercent',
                          label: 'Commission (%)',
                          type: 'number',
                          value: d.commissionPercent,
                        },
                      ],
                      submit: (data: any) =>
                        action(() => api(`/clinic/doctors/${d.id}`, 'PATCH', data)),
                    })
                  }
                >
                  Edit profile
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    action(() =>
                      api(`/clinic/doctors/${d.id}`, 'PATCH', { active: !d.active }),
                    ).catch(() => {})
                  }
                >
                  {d.active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
      <section className="panel section-gap">
        <div className="panel-heading">
          <div>
            <h2>Doctor commissions</h2>
            <p>Accrued on collected session fees, not unpaid invoices.</p>
          </div>
        </div>
        {commissions?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Doctor</th>
                  <th>Amount</th>
                  <th>Rate</th>
                  <th>Status</th>
                  <th>Payout</th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((c: any) => (
                  <tr key={c.id}>
                    <td>{data?.find((d: any) => d.id === c.doctorId)?.name}</td>
                    <td>{money(c.amountPaise)}</td>
                    <td>{c.percent}%</td>
                    <td>
                      <Badge value={c.status} />
                    </td>
                    <td>
                      {c.status === 'ACCRUED' ? (
                        <button
                          className="secondary small"
                          onClick={() =>
                            modal({
                              title: 'Record commission payout',
                              fields: [
                                {
                                  key: 'reference',
                                  label: 'Bank/payment reference',
                                  required: true,
                                },
                              ],
                              submit: (d: any) =>
                                action(() => api(`/clinic/commissions/${c.id}/payout`, 'POST', d)),
                            })
                          }
                        >
                          Record payout
                        </button>
                      ) : (
                        c.payoutReference
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No commissions accrued yet"
            text="Commissions are created when a patient pays a session invoice."
          />
        )}
      </section>
    </>
  );
}
function Team({ tick, modal, action, workspace }: any) {
  const deleteEntry = (url: string, message: string) => {
    if (window.confirm(message)) action(() => api(url, 'DELETE')).catch(() => {});
  };
  const { data: doctors } = useData('/clinic/doctors', tick);
  const restricted = workspace?.role === 'BRANCH_ADMIN';
  const roles = restricted
    ? ['DOCTOR', 'RECEPTIONIST']
    : ['MANAGER', 'BRANCH_ADMIN', 'DOCTOR', 'RECEPTIONIST', 'ACCOUNTANT'];
  const assignmentFields = (row?: any): Field[] => [
    {
      key: 'role',
      label: 'Role',
      type: 'select',
      value: row?.role || 'RECEPTIONIST',
      options: roles.map((value) => ({ value, label: value.replaceAll('_', ' ') })),
    },
    {
      key: 'branchId',
      label: 'Branch (required for branch admin)',
      type: 'select',
      value: row?.branchId || workspace?.branchId || '',
      options: [
        { value: '', label: 'All branches' },
        ...(branches || [])
          .filter((b: any) => b.active)
          .map((b: any) => ({ value: b.id, label: b.name })),
      ],
    },
    {
      key: 'doctorId',
      label: 'Doctor profile (required for doctor)',
      type: 'select',
      value: row?.doctorId || '',
      options: [
        { value: '', label: 'Choose doctor profile' },
        ...(doctors || [])
          .filter((d: any) => d.active)
          .map((d: any) => ({ value: d.id, label: d.name })),
      ],
    },
  ];
  const { data: staff, error } = useData('/clinic/staff', tick);
  const { data: branches } = useData('/clinic/branches', tick);
  return (
    <>
      <PageTitle
        title="Team & branches"
        subtitle="One connected clinic. The right access for everyone."
      >
        <button
          className="primary"
          disabled={!branches || !doctors}
          onClick={() =>
            modal({
              title: 'Create a staff account',
              subtitle: 'The team member can sign in immediately with their email and password.',
              fields: [
                { key: 'name', label: 'Name', required: true },
                { key: 'email', label: 'Email', type: 'email', required: true },
                {
                  key: 'password',
                  label: 'Initial password (12+ characters)',
                  type: 'password',
                  required: true,
                },
                ...assignmentFields(),
              ],
              submit: (d: any) => action(() => api('/clinic/staff', 'POST', d)),
            })
          }
        >
          <Plus size={17} />
          Add staff
        </button>
      </PageTitle>
      <section className="panel">
        <div className="panel-heading">
          <h2>Workspace access</h2>
        </div>
        {!staff ? (
          <DataError error={error} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role / branch</th>
                  <th>Status</th>
                  <th>Access</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s: any) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.user.name}</strong>
                    </td>
                    <td>{s.user.email}</td>
                    <td>
                      {s.role.replaceAll('_', ' ')}
                      <small style={{ display: 'block' }}>
                        {branches?.find((b: any) => b.id === s.branchId)?.name || 'All branches'}
                      </small>
                    </td>
                    <td>{s.active ? 'Active' : 'Inactive'}</td>
                    <td>
                      {s.role === 'OWNER' ? (
                        <Badge value="ACTIVE" />
                      ) : (
                        <>
                          <button
                            className="secondary small"
                            disabled={!branches || !doctors}
                            onClick={() =>
                              modal({
                                title: 'Edit staff access',
                                fields: assignmentFields(s),
                                submit: (d: any) =>
                                  action(() =>
                                    api(`/clinic/staff/${s.id}`, 'PATCH', {
                                      ...d,
                                      branchId: d.branchId || null,
                                      doctorId: d.doctorId || null,
                                    }),
                                  ),
                              })
                            }
                          >
                            Edit role
                          </button>
                          <button
                            className="secondary small"
                            onClick={() =>
                              action(() =>
                                api(`/clinic/staff/${s.id}`, 'PATCH', { active: !s.active }),
                              ).catch(() => {})
                            }
                          >
                            {s.active ? 'Disable access' : 'Enable access'}
                          </button>
                          {(workspace?.role === 'OWNER' || restricted) && (
                            <button className="text-button" onClick={() => deleteEntry(`/clinic/staff/${s.id}`, `Delete ${s.user.name}'s access to this clinic? Their clinical records will be retained.`)}>
                              Delete
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel section-gap">
        <div className="panel-heading">
          <h2>Branches</h2>
          {!restricted && (
            <button
              className="secondary small"
              onClick={() =>
                modal({
                  title: 'Add a branch',
                  fields: [
                    { key: 'name', label: 'Branch name', required: true },
                    { key: 'address', label: 'Address' },
                  ],
                  submit: (d: any) => action(() => api('/clinic/branches', 'POST', d)),
                })
              }
            >
              <Plus size={15} />
              Add branch
            </button>
          )}
        </div>
        {branches?.map((b: any) => (
          <div className="branch-row" key={b.id}>
            <span className="metric-icon mint">
              <Building2 size={20} />
            </span>
            <div>
              <strong>{b.name}</strong>
              <p>{b.address || 'Address not added'}</p>
            </div>
            <Badge value={b.active ? 'ACTIVE' : 'Inactive'} />
            {!restricted && (
              <button
                className="text-button"
                onClick={() =>
                  action(() =>
                    api(`/clinic/branches/${b.id}`, 'PATCH', { active: !b.active }),
                  ).catch(() => {})
                }
              >
                {b.active ? 'Deactivate' : 'Activate'}
              </button>
            )}
            {!restricted && (
              <button className="text-button" onClick={() => deleteEntry(`/clinic/branches/${b.id}`, `Delete branch "${b.name}"? This is only possible when no doctors, patients, appointments or staff are linked to it.`)}>
                Delete
              </button>
            )}
          </div>
        ))}
      </section>
    </>
  );
}
function Treatments({ tick, setPatient, modal, action }: any) {
  const { data, error } = useData('/clinic/plans', tick);
  const { data: patients } = useData('/clinic/patients', tick);
  return (
    <>
      <PageTitle
        title="Treatment plans"
        subtitle="Thoughtful plans, from the first visit to the final smile."
      >
        <button className="primary" onClick={() => newPlan(modal, action)}>
          <Plus size={17} />
          New treatment plan
        </button>
      </PageTitle>
      <section className="panel">
        {!data ? (
          <DataError error={error} />
        ) : !data.length ? (
          <Empty
            title="Build a path to a healthier smile"
            text="Create a treatment plan, then add tooth-wise items and sessions."
            action={() => newPlan(modal, action)}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Patient</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Care record</th>
                </tr>
              </thead>
              <tbody>
                {data.map((p: any) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.title}</strong>
                    </td>
                    <td>{patients?.find((x: any) => x.id === p.patientId)?.name}</td>
                    <td>
                      <Badge value={p.status} />
                    </td>
                    <td>{day(p.createdAt)}</td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => {
                          const pt = patients?.find((x: any) => x.id === p.patientId);
                          if (pt) setPatient(pt);
                        }}
                      >
                        View treatment <ArrowRight size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
async function newPlan(modal: any, action: any, patientId?: string) {
  const patients = await options('patients');
  modal({
    title: 'Create a treatment plan',
    fields: [
      {
        key: 'patientId',
        label: 'Patient',
        type: 'select',
        options: patients,
        value: patientId,
        required: true,
      },
      { key: 'title', label: 'Plan title', required: true },
    ],
    submit: (d: any) => action(() => api('/clinic/plans', 'POST', d)),
  });
}
function Reports({ tick }: any) {
  const { data: d, error } = useData('/clinic/reports', tick);
  if (!d) return <DataError error={error} />;
  const months = Object.entries(d.monthly) as [string, number][];
  return (
    <>
      <PageTitle
        title="Clinic reports"
        subtitle="Understand your clinic’s progress, one clear number at a time."
      />
      <div className="metrics">
        <Metric
          label="Patient invoicing"
          value={money(d.invoicedPaise)}
          detail="Total treatment & consultation charges"
          icon={FileText}
        />
        <Metric
          label="Patient collections"
          value={money(d.collectedPaise)}
          detail="Cash received against patient invoices"
          icon={Wallet}
          color="blue"
        />
        <Metric
          label="Outstanding"
          value={money(d.outstandingPaise)}
          detail="Remaining patient balance"
          icon={CreditCard}
          color="peach"
        />
        <Metric
          label="Doctor commissions"
          value={money(d.commissionPaise)}
          detail="Accrued from session collections"
          icon={Stethoscope}
          color="lavender"
        />
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Monthly patient collections</h2>
          <span className="muted">Actual recorded payments · INR</span>
        </div>
        {months.length ? (
          <div className="bar-chart">
            {months.sort().map(([month, value]) => (
              <div className="bar-chart-row" key={month}>
                <span>{month}</span>
                <div>
                  <i
                    style={{ width: `${(value / Math.max(...months.map((m) => m[1]))) * 100}%` }}
                  />
                </div>
                <strong>{money(value)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title="Your progress will take shape here"
            text="Record patient payments to see monthly collections."
          />
        )}
      </section>
    </>
  );
}
function PatientDetail({
  patient: initialPatient,
  back,
  tick,
  modal,
  action,
  workspace,
  route,
  go,
}: any) {
  const { data: livePatient } = useData(`/clinic/patients/${initialPatient.id}`, tick);
  const p = livePatient || initialPatient;
  const tab = patientTabs[route.tab || 'overview'];
  const setTab = (label: string) => {
    const key = Object.keys(patientTabs).find((k) => patientTabs[k] === label) || 'overview';
    go(`/clinic/patients/${p.id}${key === 'overview' ? '' : `/${key}`}`);
  };
  const { data: notes } = useData(
      can(workspace, 'clinical') ? `/clinic/notes?patientId=${p.id}` : '',
      tick,
    ),
    { data: plans } = useData(
      can(workspace, 'clinical') ? `/clinic/plans?patientId=${p.id}` : '',
      tick,
    ),
    { data: invoices } = useData(
      can(workspace, 'billing') ? `/clinic/invoices?patientId=${p.id}` : '',
      tick,
    ),
    { data: documents } = useData(
      can(workspace, 'documents') ? `/clinic/documents?patientId=${p.id}` : '',
      tick,
    ),
    { data: prescriptions } = useData(
      can(workspace, 'clinical') ? `/clinic/prescriptions?patientId=${p.id}` : '',
      tick,
    ),
    { data: followups } = useData(
      can(workspace, 'patients') ? `/clinic/followups?patientId=${p.id}` : '',
      tick,
    ),
    { data: communications } = useData(
      can(workspace, 'patients') ? `/clinic/communications?patientId=${p.id}` : '',
      tick,
    );
  return (
    <>
      <button className="text-button back-button" onClick={back}>
        <ChevronLeft size={17} />
        Patient directory
      </button>
      <PageTitle
        title={p.name}
        subtitle={`${p.gender} · ${p.phone} · Patient ${p.id.slice(0, 8).toUpperCase()}`}
      >
        <button className="secondary" onClick={() => patientModal(modal, action, p)}>
          Edit details
        </button>
        <button className="primary" onClick={() => appointmentModal(modal, action, p.id)}>
          <Plus size={16} />
          Book appointment
        </button>
      </PageTitle>
      <div className="patient-summary">
        <span className="large-avatar">{initials(p.name)}</span>
        <div>
          <span className="eyebrow">PATIENT RECORD</span>
          <strong>{p.email || 'Email not provided'}</strong>
          <p>
            Registered {day(p.createdAt)} ·{' '}
            {p.consent ? 'Consent recorded' : 'Consent not recorded'}
          </p>
        </div>
        <div className="allergy-alert">
          <HeartPulse size={17} />
          <div>
            <small>ALLERGIES</small>
            <strong>{p.allergies || 'None recorded'}</strong>
          </div>
        </div>
      </div>
      <div className="tabs">
        {[
          'Overview',
          'Tooth chart',
          'Treatment plans',
          'Billing',
          'Documents',
          'Prescriptions',
          'Follow-ups',
        ]
          .filter(
            (t) =>
              t === 'Overview' ||
              can(
                workspace,
                t === 'Billing'
                  ? 'billing'
                  : t === 'Documents'
                    ? 'documents'
                    : t === 'Follow-ups'
                      ? 'patients'
                      : 'clinical',
              ),
          )
          .map((t) => (
            <button key={t} className={tab === t ? 'selected' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
      </div>
      {tab === 'Overview' && (
        <div className="patient-overview-grid">
          <section className="panel">
            <div className="panel-heading">
              <h2>Clinical notes</h2>
              {can(workspace, 'clinical') && (
                <button
                  className="secondary small"
                  onClick={() =>
                    modal({
                      title: 'Add a clinical note',
                      fields: [
                        { key: 'complaint', label: 'Chief complaint', required: true },
                        { key: 'findings', label: 'Examination findings', type: 'textarea' },
                        { key: 'diagnosis', label: 'Diagnosis', type: 'textarea' },
                        { key: 'advice', label: 'Advice & next steps', type: 'textarea' },
                      ],
                      submit: (d: any) =>
                        action(() => api('/clinic/notes', 'POST', { ...d, patientId: p.id })),
                    })
                  }
                >
                  <Plus size={15} />
                  Add note
                </button>
              )}
            </div>
            {notes?.length ? (
              notes.map((n: any) => (
                <div className="clinical-note" key={n.id}>
                  <div>
                    <Badge value="Consultation" />
                    <small>{day(n.createdAt)}</small>
                  </div>
                  <h3>{n.complaint}</h3>
                  {n.findings && (
                    <p>
                      <strong>Findings:</strong> {n.findings}
                    </p>
                  )}
                  {n.diagnosis && (
                    <p>
                      <strong>Diagnosis:</strong> {n.diagnosis}
                    </p>
                  )}
                  {n.advice && (
                    <p>
                      <strong>Advice:</strong> {n.advice}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <Empty
                title="A complete picture of care"
                text="Clinical notes are stored with author and date."
              />
            )}
          </section>
          <div>
            <section className="panel">
              <div className="panel-heading">
                <h2>Medical history</h2>
              </div>
              <p className="panel-body">{p.medicalHistory || 'No medical history recorded.'}</p>
              <div className="panel-body">
                <strong>Address</strong>
                <p>{p.address || 'Not provided'}</p>
                {can(workspace, 'settings') && (
                  <button
                    className="text-button"
                    onClick={() => download(`/clinic/export?patientId=${p.id}`)}
                  >
                    Export patient record <ArrowDownToLine size={15} />
                  </button>
                )}
              </div>
            </section>
            {can(workspace, 'patients') && (
              <section className="panel section-gap">
                <div className="panel-heading">
                  <h2>Communication log</h2>
                  <button
                    className="text-button"
                    onClick={() =>
                      modal({
                        title: 'Record patient communication',
                        subtitle: 'This records a conversation; it does not send a message.',
                        fields: [
                          {
                            key: 'channel',
                            label: 'Channel',
                            type: 'select',
                            options: ['PHONE', 'EMAIL', 'SMS', 'WHATSAPP'].map((value) => ({
                              value,
                              label: value,
                            })),
                          },
                          { key: 'message', label: 'Summary', type: 'textarea', required: true },
                        ],
                        submit: (d: any) =>
                          action(() =>
                            api('/clinic/communications', 'POST', { ...d, patientId: p.id }),
                          ),
                      })
                    }
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {communications?.map((c: any) => (
                  <div className="panel-body" key={c.id}>
                    <small>
                      {day(c.createdAt)} · {c.channel}
                    </small>
                    <p>{c.message}</p>
                  </div>
                ))}
                {!communications?.length && (
                  <p className="panel-body muted">No communications recorded.</p>
                )}
              </section>
            )}
          </div>
        </div>
      )}
      {tab === 'Tooth chart' && <ToothChart patientId={p.id} tick={tick} action={action} />}
      {tab === 'Treatment plans' && (
        <>
          <div className="section-toolbar">
            <h2>A plan for every stage of care</h2>
            <button className="primary" onClick={() => newPlan(modal, action, p.id)}>
              <Plus size={16} />
              New plan
            </button>
          </div>
          {plans?.length ? (
            plans.map((plan: any) => (
              <TreatmentCard key={plan.id} plan={plan} tick={tick} modal={modal} action={action} />
            ))
          ) : (
            <section className="panel">
              <Empty
                title="Create a thoughtful treatment journey"
                text="Add a plan, tooth-wise items and multi-session treatments."
              />
            </section>
          )}
        </>
      )}
      {tab === 'Billing' && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Invoices & installments</h2>
            <button className="secondary small" onClick={() => invoiceModal(modal, action, p.id)}>
              <Plus size={15} />
              Create invoice
            </button>
          </div>
          {invoices?.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i: any) => (
                    <tr key={i.id}>
                      <td>{i.description}</td>
                      <td>{money(i.totalPaise)}</td>
                      <td>{money(i.paidPaise)}</td>
                      <td>{money(i.totalPaise - i.paidPaise)}</td>
                      <td>
                        <Badge value={i.status} />
                      </td>
                      <td>
                        {i.status !== 'PAID' && (
                          <button
                            className="secondary small"
                            onClick={() => payModal(modal, action, i)}
                          >
                            Record installment
                          </button>
                        )}
                        <button
                          className="text-button"
                          onClick={() => printInvoice(i, workspace, p)}
                        >
                          Print invoice
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="No invoices yet"
              text="Treatment sessions generate invoices automatically; consultations can be invoiced here."
            />
          )}
        </section>
      )}
      {tab === 'Documents' && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Clinical documents</h2>
              <p>PDF, JPEG or PNG · up to 3 MB per file</p>
            </div>
            <label className="primary file-button">
              <Plus size={15} />
              Upload document
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const form = new FormData();
                  form.append('patientId', p.id);
                  form.append('file', f);
                  await action(() => api('/clinic/documents', 'POST', form)).catch(() => {});
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          {documents?.length ? (
            documents.map((d: any) => (
              <div className="branch-row" key={d.id}>
                <span className="metric-icon blue">
                  <FileText size={20} />
                </span>
                <div>
                  <strong>{d.name}</strong>
                  <p>
                    {day(d.createdAt)} · {(d.bytes / 1024).toFixed(0)} KB
                  </p>
                </div>
                <button
                  className="secondary small"
                  onClick={() => download(`/clinic/documents/${d.id}/download`)}
                >
                  <ArrowDownToLine size={15} />
                  Download
                </button>
              </div>
            ))
          ) : (
            <Empty
              title="Keep every document connected"
              text="Upload X-rays, reports and signed consent forms."
            />
          )}
        </section>
      )}
      {tab === 'Prescriptions' && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Prescriptions</h2>
            <button
              className="secondary small"
              onClick={() =>
                modal({
                  title: 'Add prescription',
                  fields: [
                    {
                      key: 'medication',
                      label: 'Medication & dosage',
                      type: 'textarea',
                      required: true,
                    },
                    {
                      key: 'instructions',
                      label: 'Instructions & duration',
                      type: 'textarea',
                      required: true,
                    },
                  ],
                  submit: (d: any) =>
                    action(() => api('/clinic/prescriptions', 'POST', { ...d, patientId: p.id })),
                })
              }
            >
              <Plus size={15} />
              Add prescription
            </button>
          </div>
          {prescriptions?.length ? (
            prescriptions.map((r: any) => (
              <article className="clinical-note" key={r.id}>
                <small>{day(r.createdAt)}</small>
                <h3>{r.medication}</h3>
                <p>{r.instructions}</p>
              </article>
            ))
          ) : (
            <Empty title="No prescriptions recorded" />
          )}
        </section>
      )}
      {tab === 'Follow-ups' && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Follow-up tasks</h2>
            <button
              className="secondary small"
              onClick={() =>
                modal({
                  title: 'Schedule a follow-up',
                  fields: [
                    { key: 'title', label: 'Follow-up reason', required: true },
                    {
                      key: 'dueAt',
                      label: 'Due date & time',
                      type: 'datetime-local',
                      required: true,
                    },
                  ],
                  submit: (d: any) =>
                    action(() => api('/clinic/followups', 'POST', { ...d, patientId: p.id })),
                })
              }
            >
              <Plus size={15} />
              Add follow-up
            </button>
          </div>
          {followups?.length ? (
            followups.map((f: any) => (
              <div className="branch-row" key={f.id}>
                <div>
                  <strong>{f.title}</strong>
                  <p>Due {day(f.dueAt)}</p>
                </div>
                <Badge value={f.status} />
                <button
                  className="secondary small"
                  onClick={() =>
                    action(() =>
                      api(`/clinic/followups/${f.id}`, 'PATCH', {
                        status: f.status === 'OPEN' ? 'DONE' : 'OPEN',
                      }),
                    ).catch(() => {})
                  }
                >
                  {f.status === 'OPEN' ? 'Mark done' : 'Reopen'}
                </button>
              </div>
            ))
          ) : (
            <Empty title="No follow-ups planned" />
          )}
        </section>
      )}
    </>
  );
}
const toothConditions = [
  'Healthy',
  'Caries',
  'Filled',
  'Missing',
  'Crown',
  'Root canal',
  'Implant',
  'Planned',
];
function ToothChart({ patientId, tick, action }: any) {
  const { data: versions, error } = useData(`/clinic/charts?patientId=${patientId}`, tick);
  const [teeth, setTeeth] = useState<Record<string, any>>({}),
    [selected, setSelected] = useState('11'),
    [dentition, setDentition] = useState('Permanent'),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (versions) {
      setTeeth(versions[0]?.teeth || {});
      setDirty(false);
    }
  }, [versions]);
  // Do not allow edits before the initial chart response can initialize local state.
  if (!versions) return <DataError error={error} />;
  const rows =
    dentition === 'Permanent'
      ? [
          [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
          [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
        ]
      : [
          [55, 54, 53, 52, 51, 61, 62, 63, 64, 65],
          [85, 84, 83, 82, 81, 71, 72, 73, 74, 75],
        ];
  return (
    <section className="panel tooth-panel">
      <div className="panel-heading">
        <div>
          <h2>Interactive dental chart</h2>
          <p>FDI notation · Select a tooth to record its condition.</p>
        </div>
        <button
          className="primary small"
          disabled={!dirty}
          onClick={() =>
            action(
              () => api('/clinic/charts', 'POST', { patientId, teeth }),
              'Chart version saved',
            ).catch(() => {})
          }
        >
          <Check size={15} />
          Save chart
        </button>
      </div>
      {error && <DataError error={error} />}
      <div className="chart-layout">
        <div className="chart-main">
          <div className="segmented">
            {['Permanent', 'Primary'].map((d) => (
              <button
                key={d}
                className={dentition === d ? 'selected' : ''}
                onClick={() => {
                  setDentition(d);
                  setSelected(d === 'Permanent' ? '11' : '51');
                }}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="arch-label">UPPER ARCH</div>
          {rows.map((row, r) => (
            <React.Fragment key={r}>
              <div className={`tooth-arch ${r ? 'lower' : ''}`}>
                {row.map((n, i) => (
                  <button
                    key={n}
                    aria-label={`Tooth ${n}: ${teeth[n]?.condition || 'Healthy'}`}
                    className={`tooth ${selected === String(n) ? 'selected' : ''} condition-${(teeth[n]?.condition || 'Healthy').toLowerCase().replace(' ', '-')} ${i === row.length / 2 ? 'midline' : ''}`}
                    onClick={() => setSelected(String(n))}
                  >
                    <span>{n}</span>
                    <svg viewBox="0 0 36 50" aria-hidden="true">
                      <path d="M7 5 C2 10 4 21 8 27 L10 44 Q13 50 16 35 L18 27 L21 36 Q25 50 28 43 L30 26 C35 12 32 3 26 4 Q18 8 12 4 Z" />
                      <path d="M10 13 Q18 19 26 13 M18 16 L18 24" />
                    </svg>
                    <i />
                  </button>
                ))}
              </div>
              {r === 0 && (
                <div className="chart-mid">
                  <span>RIGHT</span>
                  <span>LEFT</span>
                </div>
              )}
            </React.Fragment>
          ))}
          <div className="arch-label">LOWER ARCH</div>
          <div className="tooth-legend">
            {toothConditions.map((c) => (
              <span key={c}>
                <i className={`condition-dot condition-${c.toLowerCase().replace(' ', '-')}`} />
                {c}
              </span>
            ))}
          </div>
        </div>
        <aside className="tooth-editor">
          <span className="eyebrow">SELECTED TOOTH</span>
          <h3>Tooth {selected}</h3>
          <label>
            Condition
            <select
              aria-label="Condition"
              value={teeth[selected]?.condition || 'Healthy'}
              onChange={(e) => {
                setTeeth({
                  ...teeth,
                  [selected]: {
                    ...teeth[selected],
                    condition: e.target.value,
                    notes: teeth[selected]?.notes || '',
                  },
                });
                setDirty(true);
              }}
            >
              {toothConditions.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Clinical notes
            <textarea
              aria-label="Clinical notes"
              placeholder="Surfaces, findings or planned care…"
              value={teeth[selected]?.notes || ''}
              onChange={(e) => {
                setTeeth({
                  ...teeth,
                  [selected]: {
                    condition: teeth[selected]?.condition || 'Healthy',
                    notes: e.target.value,
                  },
                });
                setDirty(true);
              }}
            />
          </label>
          <div className="chart-history">
            <ShieldCheck size={17} />
            <p>Each save creates a dated version. Earlier chart records stay intact.</p>
          </div>
          <small>{versions?.length || 0} saved versions</small>
          {versions?.length > 1 && (
            <select
              aria-label="View chart history"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  setTeeth(versions.find((v: any) => v.id === e.target.value).teeth);
                  setDirty(false);
                }
              }}
            >
              <option value="">View a saved version</option>
              {versions.map((v: any) => (
                <option key={v.id} value={v.id}>
                  {new Date(v.createdAt).toLocaleString('en-IN')}
                </option>
              ))}
            </select>
          )}
        </aside>
      </div>
    </section>
  );
}
function TreatmentCard({ plan, tick, modal, action }: any) {
  const { data: items } = useData(`/clinic/items?planId=${plan.id}`, tick);
  const addItem = async () => {
    const catalog = await api('/clinic/charges?active=true');
    modal({
      title: 'Add tooth-wise treatment',
      fields: [
        { key: 'tooth', label: 'FDI tooth number (e.g. 36)', required: true },
        {
          key: 'catalogItemId',
          label: 'Charge master',
          type: 'select',
          value: '',
          options: catalog.map((row: any) => ({ value: row.id, label: row.name })),
          updates: Object.fromEntries(
            catalog.map((row: any) => [
              row.id,
              {
                name: row.name,
                pricePaise: row.pricePaise / 100,
                labChargePaise: (row.labChargePaise || 0) / 100,
                plannedSessions: row.sessions,
              },
            ]),
          ),
        },
        { key: 'name', label: 'Treatment name', required: true, value: catalog[0]?.name || '' },
        {
          key: 'labChargePaise',
          label: 'Lab charge (₹)',
          type: 'money',
          required: true,
          value: (catalog[0]?.labChargePaise || 0) / 100,
        },
        {
          key: 'pricePaise',
          label: 'Total treatment price (₹)',
          type: 'money',
          value: catalog[0]?.pricePaise / 100,
          required: true,
        },
        {
          key: 'plannedSessions',
          label: 'Planned sessions',
          type: 'number',
          value: catalog[0]?.sessions || 1,
          required: true,
        },
      ],
      submit: (d: any) => action(() => api('/clinic/items', 'POST', { ...d, planId: plan.id })),
    });
  };
  return (
    <section className="panel section-gap">
      <div className="panel-heading">
        <div>
          <h2>
            {plan.title} <Badge value={plan.status} />
          </h2>
          <p>
            Created {day(plan.createdAt)} · {items?.length || 0} treatment items
          </p>
        </div>
        <div className="heading-actions">
          <select
            aria-label="Plan status"
            value={plan.status}
            onChange={(e) =>
              action(() =>
                api(`/clinic/plans/${plan.id}`, 'PATCH', { status: e.target.value }),
              ).catch(() => {})
            }
          >
            {['PROPOSED', 'ACCEPTED', 'COMPLETED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>
                {statuses[s]}
              </option>
            ))}
          </select>
          <button className="secondary small" onClick={addItem}>
            <Plus size={15} />
            Add treatment
          </button>
        </div>
      </div>
      {items?.length ? (
        items.map((i: any) => (
          <TreatmentItemView
            item={i}
            key={i.id}
            tick={tick}
            modal={modal}
            action={action}
            accepted={plan.status === 'ACCEPTED'}
          />
        ))
      ) : (
        <p className="panel-body muted">
          Add a tooth number, treatment price and planned session count.
        </p>
      )}
    </section>
  );
}
function TreatmentItemView({ item: i, tick, modal, action, accepted }: any) {
  const { data: sessions } = useData(`/clinic/sessions?itemId=${i.id}`, tick);
  const add = async () => {
    const doctors = await options('doctors');
    const billed = sessions?.reduce((s: number, r: any) => s + r.feePaise, 0) || 0;
    modal({
      title: `Record session ${(sessions?.length || 0) + 1}`,
      subtitle: `${i.name} · Tooth ${i.tooth} · Remaining treatment fee ${money(i.pricePaise - billed)}`,
      fields: [
        {
          key: 'doctorId',
          label: 'Treating doctor',
          type: 'select',
          options: doctors,
          required: true,
        },
        { key: 'notes', label: 'Procedure notes', type: 'textarea', required: true },
        {
          key: 'feePaise',
          label: 'Session fee (₹)',
          type: 'money',
          required: true,
          value:
            Math.round((i.pricePaise - billed) / (i.plannedSessions - (sessions?.length || 0))) /
            100,
        },
      ],
      submit: (d: any) =>
        action(
          () => api('/clinic/sessions', 'POST', { ...d, itemId: i.id }),
          'Session recorded and patient invoice created',
        ),
    });
  };
  return (
    <div className="treatment-item">
      <div className="treatment-item-top">
        <span className="tooth-number">{i.tooth}</span>
        <div>
          <h3>{i.name}</h3>
          <p className="muted">Lab charge: {money(i.labChargePaise || 0)}</p>
          <small>
            {sessions?.length || 0} of {i.plannedSessions} sessions · {money(i.pricePaise)}
          </small>
        </div>
        <Badge value={i.status} />
        {accepted && i.status !== 'COMPLETED' && (
          <button className="secondary small" onClick={add}>
            <Plus size={15} />
            Record session
          </button>
        )}
      </div>
      {sessions?.map((s: any, n: number) => (
        <div className="session-row" key={s.id}>
          <span className="session-number">{n + 1}</span>
          <div>
            <strong>{s.notes}</strong>
            <small>
              {day(s.performedAt)} · Fee {money(s.feePaise)}
            </small>
          </div>
          <CheckCircle2 size={17} />
        </div>
      ))}
    </div>
  );
}
async function download(url: string) {
  const response = await fetch(`/api${url}`);
  if (!response.ok) {
    const e = await response.json();
    window.alert(e.error);
    return;
  }
  const blob = await response.blob();
  const objectURL = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectURL;
  a.download =
    response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ||
    'clinic-export.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
}
function ClinicSettings({ workspace, tick, modal, action, navigate }: any) {
  currentWorkspace = workspace;

  const t = workspace?.tenant;
  if (!t) return <DataError />;
  return (
    <>
      <PageTitle title="Clinic settings" subtitle="A workspace that feels like your clinic.">
        <button
          className="primary"
          onClick={() =>
            modal({
              title: 'Clinic profile & branding',
              fields: [
                { key: 'name', label: 'Clinic name', value: t.name, required: true },
                { key: 'phone', label: 'Contact phone', value: t.phone },
                { key: 'address', label: 'Address', type: 'textarea', value: t.settings?.address },
                { key: 'contactEmail', label: 'Clinic email', type: 'email', value: t.settings?.contactEmail },
                { key: 'website', label: 'Clinic website', type: 'url', value: t.settings?.website },
                { key: 'tagline', label: 'Clinic tagline', value: t.settings?.tagline },
                { key: 'logoUrl', label: 'Logo URL', type: 'url', value: t.settings?.logoUrl },
                {
                  key: 'timezone',
                  label: 'Time zone',
                  value: t.settings?.timezone || 'Asia/Kolkata',
                },
                {
                  key: 'appointmentHours',
                  label: 'Appointment hours',
                  value: t.settings?.appointmentHours,
                },
                {
                  key: 'invoiceHeader',
                  label: 'Invoice header',
                  type: 'textarea',
                  value: t.settings?.invoiceHeader,
                },
                {
                  key: 'invoiceFooter',
                  label: 'Invoice footer',
                  type: 'textarea',
                  value: t.settings?.invoiceFooter,
                },
              ],
              submit: ({ name, phone, ...settings }: any) =>
                action(() => api('/clinic/settings', 'PATCH', { name, phone, settings })),
            })
          }
        >
          Edit clinic profile
        </button>
      </PageTitle>
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Clinic profile</h2>
            <span className="metric-icon mint">
              <Building2 size={20} />
            </span>
          </div>
          <dl className="details-list">
            <dt>Clinic name</dt>
            <dd>{t.name}</dd>
            <dt>Phone</dt>
            <dd>{t.phone}</dd>
            <dt>Address</dt>
            <dd>{t.settings?.address || 'Not added'}</dd>
            <dt>Workspace slug</dt>
            <dd>{t.slug}</dd>
            <dt>Time zone</dt>
            <dd>{t.settings?.timezone}</dd>
            <dt>Currency</dt>
            <dd>INR · Indian rupee</dd>
            <dt>Appointment hours</dt>
            <dd>{t.settings?.appointmentHours || 'Not configured'}</dd>
          </dl>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Data ownership</h2>
            <ShieldCheck size={21} />
          </div>
          <div className="panel-body">
            <p>
              Your clinic owns its patient and financial records. Subscription expiry pauses
              protected operations; it does not delete data.
            </p>
            <button className="secondary" onClick={() => download('/clinic/export')}>
              <ArrowDownToLine size={16} />
              Export clinic records
            </button>
            <p className="muted">
              JSON export includes treatment, billing and document metadata. Download attachments
              separately. Export availability follows your plan.
            </p>
            <button
              className="text-button danger"
              onClick={() =>
                modal({
                  title: 'Request account closure',
                  subtitle:
                    'Support will review retention and export requirements before any deletion.',
                  fields: [
                    {
                      key: 'reason',
                      label: 'Reason for closure',
                      type: 'textarea',
                      required: true,
                    },
                  ],
                  button: 'Submit request',
                  submit: (d: any) =>
                    action(
                      () => api('/subscription/closure', 'POST', d),
                      'Closure request recorded',
                    ),
                })
              }
            >
              Request account closure
            </button>
          </div>
        </section>
      </div>
      <section className="panel section-gap">
        <div className="panel-heading">
          <div>
            <h2>Clinic masters</h2>
            <p>Manage specialities, charge groups, charges and lab charges in one place.</p>
          </div>
          <button className="secondary small" onClick={() => navigate('masters')}>
            Open masters
          </button>
        </div>
      </section>
    </>
  );
}
function Subscription({ tick, modal, action }: any) {
  const { data: d, error } = useData('/subscription', tick);
  const { data: usage } = useData('/clinic/usage', tick);
  const [interval, setInterval] = useState('MONTHLY'),
    [coupon, setCoupon] = useState('');
  if (!d) return <DataError error={error} />;
  const sub = d.subscription;
  const checkout = async (plan: any) => {
    try {
      const order = await api('/subscription/checkout', 'POST', {
        planId: plan.id,
        interval,
        coupon: coupon || undefined,
      });
      if (!(window as any).Razorpay)
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Unable to load checkout.'));
          document.body.appendChild(script);
        });
      const rp = new (window as any).Razorpay({
        key: order.key,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'DentaFlow',
        description: `${plan.name} ${interval.toLowerCase()} subscription`,
        handler: () =>
          action(
            async () => {},
            'Payment submitted. Your plan updates after the verified webhook.',
          ).catch(() => {}),
      });
      rp.open();
    } catch (e: any) {
      modal({
        title: 'Checkout unavailable',
        subtitle: e.message,
        fields: [],
        submit: async () => {},
      });
    }
  };
  return (
    <>
      <PageTitle
        title="Your subscription"
        subtitle="More room for your clinic to grow, without the extra admin."
      />
      <section className="subscription-banner">
        <div>
          <span className="eyebrow">CURRENT PLAN</span>
          <h2>
            {sub.plan.name} <Badge value={sub.status} />
          </h2>
          <p>
            {sub.cancelAtPeriodEnd ? 'Cancels' : 'Current period ends'} {day(sub.endsAt)} ·{' '}
            {sub.interval.toLowerCase()} billing
          </p>
        </div>
        <div>
          <strong>
            {money(sub.plan.monthlyPaise)}
            <small> / month</small>
          </strong>
          <button
            className="secondary small"
            onClick={() =>
              modal({
                title: sub.cancelAtPeriodEnd ? 'Resume subscription' : 'Cancel at period end',
                subtitle:
                  'Your clinical records are retained. Access follows the subscription and grace-period policy.',
                fields: [],
                button: sub.cancelAtPeriodEnd ? 'Resume' : 'Cancel subscription',
                submit: () =>
                  action(() =>
                    api(`/subscription/${sub.cancelAtPeriodEnd ? 'resume' : 'cancel'}`, 'POST', {}),
                  ),
              })
            }
          >
            {sub.cancelAtPeriodEnd ? 'Resume subscription' : 'Cancel renewal'}
          </button>
        </div>
      </section>
      {usage && (
        <section className="panel section-gap">
          <div className="panel-heading">
            <h2>Workspace usage</h2>
          </div>
          <div className="usage-grid">
            {['doctors', 'staff', 'branches', 'patients'].map((k) => (
              <div key={k}>
                <span>
                  {k.charAt(0).toUpperCase() + k.slice(1)}
                  <strong>
                    {usage.usage[k]} / {usage.limits[k] ?? 'Unlimited'}
                  </strong>
                </span>
                <div className="usage-track">
                  <i
                    style={{
                      width:
                        usage.limits[k] == null
                          ? '10%'
                          : `${Math.min(100, (usage.usage[k] / Math.max(1, usage.limits[k])) * 100)}%`,
                    }}
                  />
                </div>
                {usage.limits[k] != null && usage.usage[k] >= usage.limits[k] * 0.8 && (
                  <small>Approaching your plan limit</small>
                )}
              </div>
            ))}
          </div>
          <p className="panel-body muted">
            Documents: {(usage.usage.storageBytes / 1024 / 1024).toFixed(1)} MB used
            {usage.limits.storageBytes == null
              ? ' · Unlimited storage'
              : ` of ${(usage.limits.storageBytes / 1024 / 1024).toFixed(0)} MB`}
          </p>
        </section>
      )}
      <div className="coupon-input">
        <label>
          Promotional code
          <input
            value={coupon}
            onChange={(e) => setCoupon(e.target.value.toUpperCase())}
            placeholder="Optional coupon code"
          />
        </label>
      </div>
      <div className="section-toolbar">
        <h2>A plan for every stage</h2>
        <div className="segmented">
          {['MONTHLY', 'ANNUAL'].map((s) => (
            <button
              key={s}
              className={interval === s ? 'selected' : ''}
              onClick={() => setInterval(s)}
            >
              {s === 'MONTHLY' ? 'Monthly' : 'Annual'}
            </button>
          ))}
        </div>
      </div>
      <div className="pricing-grid">
        {d.plans.map((p: any) => (
          <PlanCard
            key={p.id}
            plan={p}
            interval={interval}
            button={p.id === sub.planId ? 'Renew plan' : 'Choose plan'}
            onClick={() => checkout(p)}
          />
        ))}
      </div>
      <section className="panel section-gap">
        <div className="panel-heading">
          <h2>SaaS subscription invoices</h2>
          <span className="muted">Software subscription ledger</span>
        </div>
        {d.invoices.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Subtotal</th>
                  <th>Tax</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {d.invoices.map((i: any) => (
                  <tr key={i.id}>
                    <td>{i.id.slice(0, 8)}</td>
                    <td>{day(i.createdAt)}</td>
                    <td>{money(i.subtotalPaise)}</td>
                    <td>{money(i.taxPaise)}</td>
                    <td>{money(i.totalPaise)}</td>
                    <td>
                      <Badge value={i.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Your trial is on us"
            text="Subscription invoices appear here when you start a paid plan."
          />
        )}
      </section>
    </>
  );
}
function Support({ tick, modal, action }: any) {
  const { data, error } = useData('/subscription/support', tick);
  return (
    <>
      <PageTitle title="We’re here to help" subtitle="A little support goes a long way.">
        <button
          className="primary"
          onClick={() =>
            modal({
              title: 'Send a support request',
              fields: [
                { key: 'subject', label: 'Subject', required: true },
                { key: 'message', label: 'How can we help?', type: 'textarea', required: true },
              ],
              submit: (d: any) =>
                action(() => api('/subscription/support', 'POST', d), 'Support request created'),
            })
          }
        >
          <Plus size={16} />
          New request
        </button>
      </PageTitle>
      <section className="support-intro">
        <LifeBuoy size={32} />
        <div>
          <h2>Your clinic, supported</h2>
          <p>
            Tell us about a product issue, onboarding question or subscription request. Avoid
            including patient clinical information.
          </p>
        </div>
      </section>
      <section className="panel section-gap">
        <div className="panel-heading">
          <h2>Your requests</h2>
        </div>
        {!data ? (
          <DataError error={error} />
        ) : data.length ? (
          data.map((r: any) => (
            <article className="clinical-note" key={r.id}>
              <div>
                <h3>{r.subject}</h3>
                <Badge value={r.status} />
              </div>
              <p>{r.message}</p>
              <small>{day(r.createdAt)}</small>
              {r.notes && (
                <p className="support-reply">
                  <strong>Support note:</strong> {r.notes}
                </p>
              )}
            </article>
          ))
        ) : (
          <Empty title="No support requests" text="We’re here whenever you need a hand." />
        )}
      </section>
      <SupportGrants tick={tick} modal={modal} action={action} />
    </>
  );
}
function PlanCard({ plan: p, interval = 'MONTHLY', onClick, button = 'Start free trial' }: any) {
  return (
    <section className={`pricing-card ${p.name === 'Professional' ? 'featured' : ''}`}>
      {p.name === 'Professional' && <span className="popular">A little more possibility</span>}
      <span className="eyebrow">{p.name}</span>
      <h3>
        {money(interval === 'ANNUAL' ? p.annualPaise : p.monthlyPaise)}
        <small> / {interval === 'ANNUAL' ? 'year' : 'month'}</small>
      </h3>
      <p>
        {p.name === 'Starter'
          ? 'For a focused, independent practice.'
          : p.name === 'Professional'
            ? 'For growing clinics and connected teams.'
            : 'For ambitious teams with bigger plans.'}
      </p>
      <button className={p.name === 'Professional' ? 'primary' : 'secondary'} onClick={onClick}>
        {button}
        <ArrowRight size={16} />
      </button>
      <ul>
        {[
          `${p.limits.doctors ?? 'Unlimited'} doctors`,
          `${p.limits.staff ?? 'Unlimited'} staff accounts`,
          `${p.limits.branches ?? 'Unlimited'} ${p.limits.branches === 1 ? 'branch' : 'branches'}`,
          'Dental EMR & tooth chart',
          'Multi-session treatments',
          'Installment billing',
          ...(p.features.export ? ['Clinic data export'] : []),
          ...(p.features.customBranding ? ['Custom clinic branding'] : []),
        ].map((f) => (
          <li key={f}>
            <Check size={15} />
            {f}
          </li>
        ))}
      </ul>
      <small>
        {p.trialDays}-day trial · Patient records {p.limits.patients ?? 'unlimited'}
      </small>
    </section>
  );
}
function FormModal({ modal, close, notify, refresh }: any) {
  const [values, setValues] = useState<Record<string, any>>(() =>
      Object.fromEntries(
        modal.fields.map((f: Field) => [
          f.key,
          f.value ??
            (f.type === 'checkbox'
              ? false
              : f.type === 'multiselect' ? [] : f.type === 'select'
                ? f.options?.[0]?.value || ''
                : ''),
        ]),
      ),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [receipt, setReceipt] = useState('');
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [busy]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) close();
      }}
    >
      <section className="modal" role="dialog" aria-modal="true" aria-label={modal.title}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">DENTAFLOW WORKSPACE</span>
            <h2>{modal.title}</h2>
          </div>
          <button className="icon-button" onClick={close} disabled={busy} aria-label="Close dialog">
            <X size={20} />
          </button>
        </div>
        {modal.subtitle && <p className="modal-subtitle">{modal.subtitle}</p>}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            setBusy(true);
            const body: any = {};
            try {
              for (const f of modal.fields) {
                const v = values[f.key];
                if ((v === '' || v === undefined) && !f.required) {
                  if (['select', 'datetime-local', 'number', 'money', 'url'].includes(f.type || ''))
                    continue;
                  body[f.key] = '';
                  continue;
                }
                body[f.key] =
                  f.type === 'money'
                    ? Math.round(Number(v) * 100)
                    : f.type === 'number'
                      ? Number(v)
                      : f.type === 'datetime-local'
                        ? new Date(v).toISOString()
                        : v;
              }
              const result = await modal.submit(body);
              refresh();
              notify('Saved successfully');
              if (result?.developmentToken) {
                setReceipt(result.developmentToken);
                return;
              }
              close();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-fields">
            {modal.fields.map((f: Field) => (
              <label
                key={f.key}
                className={
                  f.type === 'textarea'
                    ? 'full'
                    : f.type === 'checkbox'
                      ? 'checkbox-label full'
                      : ''
                }
              >
                {f.type === 'checkbox' ? (
                  <>
                    <input
                      aria-label={f.label}
                      type="checkbox"
                      checked={values[f.key]}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })}
                    />
                    {f.label}
                  </>
                ) : (
                  <>
                    {f.label}
                    {f.required && <span className="required"> *</span>}
                    {f.type === 'multiselect' ? (
                      <select multiple aria-label={f.label} required={f.required} value={values[f.key]} size={Math.min(5, Math.max(2, f.options?.length || 2))} onChange={(e) => setValues({ ...values, [f.key]: Array.from(e.target.selectedOptions, option => option.value) })}>
                        {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : f.type === 'select' ? (
                      <select
                        aria-label={f.label}
                        required={f.required}
                        value={values[f.key]}
                        onChange={(e) =>
                          setValues({
                            ...values,
                            [f.key]: e.target.value,
                            ...f.updates?.[e.target.value],
                          })
                        }
                      >
                        {!f.required && <option value="">Choose an option</option>}
                        {f.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : f.type === 'textarea' ? (
                      <textarea
                        aria-label={f.label}
                        required={f.required}
                        value={values[f.key]}
                        onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                      />
                    ) : (
                      <input
                        aria-label={f.label}
                        autoFocus={f === modal.fields[0]}
                        type={f.type === 'money' ? 'number' : f.type || 'text'}
                        step={f.type === 'money' ? '0.01' : undefined}
                        min={['number', 'money'].includes(f.type || '') ? 0 : undefined}
                        required={f.required}
                        value={Number.isNaN(values[f.key]) ? '' : values[f.key]}
                        onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                      />
                    )}
                  </>
                )}
                {f.hint && <small>{f.hint}</small>}
              </label>
            ))}
          </div>
          {receipt && (
            <div className="development-token modal-token">
              <strong>Development only — single-use verification/reset code</strong>
              <code>{receipt}</code>
              <small>
                Use this code in the account verification or password reset screen. Production
                delivers it by email.
              </small>
            </div>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="modal-footer">
            <button type="button" className="secondary" onClick={close} disabled={busy}>
              Close
            </button>
            {!receipt && (modal.fields.length > 0 || modal.button) ? (
              <button className="primary" disabled={busy}>
                {busy ? 'Saving…' : modal.button || 'Save changes'}
                <ArrowRight size={16} />
              </button>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}
function Admin({ screen, tick, modal, action, search }: any) {
  const routes: Record<string, string> = {
    platform: 'dashboard',
    clinics: 'tenants',
    plans: 'plans',
    subscriptions: 'subscriptions',
    'saas-payments': 'invoices',
    'platform-support': 'support',
    audit: 'audit',
    settings: 'settings',
  };
  const { data: d, error } = useData(
    `/platform/${routes[screen] || 'dashboard'}${screen === 'clinics' ? `?q=${encodeURIComponent(search)}` : ''}`,
    tick,
  );
  const { data: plans } = useData('/platform/plans', tick);
  if (!d) return <DataError error={error} />;
  if (screen === 'platform')
    return (
      <>
        <PageTitle
          eyebrow="DENTAFLOW PLATFORM"
          title="Your business at a glance"
          subtitle="Independent clinics. One connected platform."
        />
        <div className="metrics">
          <Metric
            label="Registered clinics"
            value={d.totalClinics}
            detail={`${d.newThisMonth} new this month`}
            icon={Building2}
          />
          <Metric
            label="Active customers"
            value={d.active}
            detail={`${d.trial} clinics in trial`}
            icon={Users}
            color="blue"
          />
          <Metric
            label="Monthly recurring revenue"
            value={money(d.mrrPaise)}
            detail="Active subscriptions · tax excluded"
            icon={TrendingUp}
            color="peach"
          />
          <Metric
            label="Annual recurring revenue"
            value={money(d.arrPaise)}
            detail="Monthly recurring revenue × 12"
            icon={Wallet}
            color="lavender"
          />
        </div>
        <div className="dashboard-grid">
          <section className="panel">
            <div className="panel-heading">
              <h2>Plan distribution</h2>
            </div>
            <div className="bar-chart">
              {d.plans.map((p: any) => (
                <div className="bar-chart-row" key={p.id}>
                  <span>{p.name}</span>
                  <div>
                    <i style={{ width: `${(p.count / (d.totalClinics || 1)) * 100}%` }} />
                  </div>
                  <strong>{p.count} clinics</strong>
                </div>
              ))}
            </div>
            <div className="analytics-notes">
              <span>
                Collections<strong>{money(d.collectionsPaise)}</strong>
              </span>
              <span>
                Failed payments<strong>{d.failedPayments}</strong>
              </span>
              <span>
                Trial-to-paid<strong>{(d.trialToPaid * 100).toFixed(1)}%</strong>
              </span>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Needs your attention</h2>
            </div>
            <div className="platform-attention">
              <span>
                <LifeBuoy size={19} />
                Open support requests<strong>{d.openSupport}</strong>
              </span>
              <span>
                <CreditCard size={19} />
                Expired subscriptions<strong>{d.expired}</strong>
              </span>
              <span>
                <ShieldCheck size={19} />
                Suspended clinics<strong>{d.suspended}</strong>
              </span>
              <span>
                <Activity size={19} />
                Cancellation requests<strong>{d.cancellations}</strong>
              </span>
            </div>
          </section>
          <section className="panel wide">
            <div className="panel-heading">
              <h2>Recent subscription activity</h2>
            </div>
            {d.events.length ? (
              d.events.map((e: any) => (
                <div className="event-row" key={e.id}>
                  <span className="small-icon">
                    <Activity size={17} />
                  </span>
                  <div>
                    <strong>{e.kind.replace(/_/g, ' ')}</strong>
                    <small>
                      Clinic {e.tenantId?.slice(0, 8) || 'Platform'} ·{' '}
                      {new Date(e.createdAt).toLocaleString('en-IN')}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <Empty
                title="Ready for your first clinic"
                text="New trials and payment activity will appear here."
              />
            )}
          </section>
        </div>
        <p className="muted methodology">
          MRR normalizes annual subscriptions to one month, excludes trials and tax, and uses
          recorded recurring prices. Collections represent cash received less processed refunds.
          Neither figure is recognized revenue. Trial conversion is the share of registered
          subscriptions that have a recorded paid recurring price.
        </p>
      </>
    );
  if (screen === 'clinics')
    return (
      <>
        <PageTitle
          title="Clinic management"
          subtitle="Support each clinic without accessing its patient records."
        >
          <button
            className="primary"
            onClick={() =>
              modal({
                title: 'Register a clinic',
                subtitle: 'Registration starts a trial. The owner can sign in immediately.',
                fields: [
                  { key: 'clinicName', label: 'Clinic name', required: true },
                  { key: 'name', label: 'Owner name', required: true },
                  { key: 'email', label: 'Owner email', type: 'email', required: true },
                  { key: 'phone', label: 'Phone', required: true },
                  {
                    key: 'password',
                    label: 'Initial password (12+ characters)',
                    type: 'password',
                    required: true,
                  },
                  {
                    key: 'planId',
                    label: 'Trial plan',
                    type: 'select',
                    options: plans
                      ?.filter((p: any) => p.available)
                      .map((p: any) => ({ value: p.id, label: p.name })),
                    required: true,
                  },
                  {
                    key: 'acceptTerms',
                    label: 'Owner has accepted the terms',
                    type: 'checkbox',
                    value: false,
                  },
                ],
                submit: (data: any) => action(() => api('/auth/register', 'POST', data)),
              })
            }
          >
            <Plus size={16} />
            Register clinic
          </button>
        </PageTitle>
        <section className="panel">
          {d.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Clinic</th>
                    <th>Owner</th>
                    <th>Plan</th>
                    <th>Status</th>
                    <th>Subscription</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {d.map((t: any) => (
                    <tr key={t.id}>
                      <td>
                        <strong>{t.name}</strong>
                        <small>{t.slug}</small>
                        <small>{t.id.slice(0, 8)}</small>
                      </td>
                      <td>
                        {t.ownerEmail}
                        <small>{t.phone}</small>
                      </td>
                      <td>{t.subscription?.plan.name}</td>
                      <td>
                        <Badge value={t.status} />
                      </td>
                      <td>
                        <Badge value={t.subscription?.status} />
                        <small>Ends {t.subscription && day(t.subscription.endsAt)}</small>
                      </td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="secondary small"
                            onClick={() =>
                              modal({
                                title:
                                  t.status === 'SUSPENDED' ? 'Activate clinic' : 'Suspend clinic',
                                subtitle:
                                  'The owner will retain access to subscriptions and support. Patient records are retained.',
                                fields: [
                                  { key: 'reason', label: 'Recorded reason', required: true },
                                ],
                                submit: (data: any) =>
                                  action(() =>
                                    api(`/platform/tenants/${t.id}`, 'PATCH', {
                                      ...data,
                                      status: t.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED',
                                    }),
                                  ),
                              })
                            }
                          >
                            {t.status === 'SUSPENDED' ? 'Activate' : 'Suspend'}
                          </button>
                          <button
                            className="text-button"
                            onClick={() =>
                              modal({
                                title: 'Manage subscription',
                                subtitle:
                                  'Manual activation is audited. Existing patient and doctor records remain intact on a downgrade.',
                                fields: [
                                  {
                                    key: 'planId',
                                    label: 'Plan',
                                    type: 'select',
                                    value: t.subscription?.planId,
                                    options: plans?.map((p: any) => ({
                                      value: p.id,
                                      label: p.name,
                                    })),
                                    required: true,
                                  },
                                  {
                                    key: 'status',
                                    label: 'Status',
                                    type: 'select',
                                    value: t.subscription?.status,
                                    options: ['TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED'].map(
                                      (value) => ({ value, label: statuses[value] }),
                                    ),
                                  },
                                  {
                                    key: 'interval',
                                    label: 'Billing interval',
                                    type: 'select',
                                    value: t.subscription?.interval,
                                    options: [
                                      { value: 'MONTHLY', label: 'Monthly' },
                                      { value: 'ANNUAL', label: 'Annual' },
                                    ],
                                  },
                                  {
                                    key: 'days',
                                    label: 'Days from today',
                                    type: 'number',
                                    value: 30,
                                    required: true,
                                  },
                                  { key: 'reason', label: 'Reason for change', required: true },
                                ],
                                submit: (data: any) =>
                                  action(() =>
                                    api(`/platform/tenants/${t.id}/subscription`, 'POST', data),
                                  ),
                              })
                            }
                          >
                            Subscription
                          </button>
                          <button
                            className="text-button"
                            onClick={() =>
                              modal({
                                title: 'Request owner password reset',
                                subtitle:
                                  'A single-use reset code is sent to the owner. You will not see the password.',
                                fields: [],
                                button: 'Send reset email',
                                submit: () =>
                                  action(
                                    () => api(`/platform/tenants/${t.id}/reset-owner`, 'POST', {}),
                                    'Reset requested',
                                  ),
                              })
                            }
                          >
                            Reset owner
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No clinics registered yet" />
          )}
        </section>
      </>
    );
  if (screen === 'plans')
    return (
      <>
        <PageTitle
          title="Subscription plans"
          subtitle="Configure prices, limits and features as your business grows."
        >
          <button className="primary" onClick={() => planModal(modal, action)}>
            <Plus size={16} />
            Create plan
          </button>
        </PageTitle>
        <div className="pricing-grid">
          {d.map((p: any) => (
            <PlanCard
              key={p.id}
              plan={p}
              button="Edit plan"
              onClick={() => planModal(modal, action, p)}
            />
          ))}
        </div>
        <section className="panel section-gap">
          <div className="panel-heading">
            <div>
              <h2>Promotional coupons</h2>
              <p>Percentage discounts on server-created checkout orders.</p>
            </div>
            <button
              className="secondary"
              onClick={() =>
                modal({
                  title: 'Create a coupon',
                  fields: [
                    { key: 'code', label: 'Code (uppercase letters / numbers)', required: true },
                    { key: 'percent', label: 'Discount (%)', type: 'number', required: true },
                    {
                      key: 'expiresAt',
                      label: 'Expires at',
                      type: 'datetime-local',
                      required: true,
                    },
                    { key: 'active', label: 'Coupon active', type: 'checkbox', value: true },
                  ],
                  submit: (data: any) => action(() => api('/platform/coupons', 'POST', data)),
                })
              }
            >
              <Plus size={15} />
              Create coupon
            </button>
          </div>
          <CouponList tick={tick} />
        </section>
      </>
    );
  if (screen === 'settings')
    return (
      <>
        <PageTitle
          title="Platform settings"
          subtitle="Product identity, support details and configurable tax."
        >
          <button
            className="primary"
            onClick={() =>
              modal({
                title: 'Edit platform settings',
                fields: [
                  {
                    key: 'productName',
                    label: 'Product name',
                    value: d.productName || 'DentaFlow',
                    required: true,
                  },
                  {
                    key: 'supportEmail',
                    label: 'Support email',
                    type: 'email',
                    value: d.supportEmail,
                    required: true,
                  },
                  { key: 'supportPhone', label: 'Support phone', value: d.supportPhone },
                  {
                    key: 'taxBps',
                    label: 'Tax in basis points (1800 = 18%)',
                    type: 'number',
                    value: d.taxBps || 0,
                    required: true,
                  },
                  {
                    key: 'defaultTrialDays',
                    label: 'Default trial days',
                    type: 'number',
                    value: d.defaultTrialDays || 14,
                  },
                  { key: 'currency', label: 'Currency', value: 'INR', required: true },
                  { key: 'termsUrl', label: 'Terms URL', type: 'url', value: d.termsUrl },
                  { key: 'privacyUrl', label: 'Privacy URL', type: 'url', value: d.privacyUrl },
                  {
                    key: 'maintenanceNotice',
                    label: 'Maintenance notice',
                    type: 'textarea',
                    value: d.maintenanceNotice,
                  },
                ],
                submit: (data: any) => action(() => api('/platform/settings', 'PATCH', data)),
              })
            }
          >
            Edit settings
          </button>
        </PageTitle>
        <section className="panel">
          <dl className="details-list">
            {Object.entries(d).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt>{k.replace(/([A-Z])/g, ' $1')}</dt>
                <dd>{String(v) || 'Not configured'}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
      </>
    );
  if (screen === 'platform-support')
    return (
      <>
        <PageTitle
          title="Customer support"
          subtitle="An auditable record of customer requests and follow-through."
        />
        <section className="panel">
          {d.length ? (
            d.map((r: any) => (
              <article className="clinical-note" key={r.id}>
                <div>
                  <h3>{r.subject}</h3>
                  <Badge value={r.status} />
                </div>
                <small>
                  Clinic {r.tenantId.slice(0, 8)} · {day(r.createdAt)}
                </small>
                <p>{r.message}</p>
                {r.notes && <p>{r.notes}</p>}
                <button
                  className="secondary small"
                  onClick={() =>
                    modal({
                      title: 'Update support request',
                      fields: [
                        {
                          key: 'status',
                          label: 'Status',
                          type: 'select',
                          value: r.status,
                          options: ['OPEN', 'IN_PROGRESS', 'CLOSED'].map((value) => ({
                            value,
                            label: statuses[value] || value,
                          })),
                        },
                        {
                          key: 'notes',
                          label: 'Support notes (visible to clinic owner)',
                          type: 'textarea',
                          value: r.notes,
                        },
                      ],
                      submit: (data: any) =>
                        action(() => api(`/platform/support/${r.id}`, 'PATCH', data)),
                    })
                  }
                >
                  Update request
                </button>
              </article>
            ))
          ) : (
            <Empty
              title="No open conversations"
              text="Clinic owners can submit support requests from their workspace."
            />
          )}
        </section>
        <SupportGrants tick={tick} modal={modal} action={action} platform />
      </>
    );
  const rows =
    screen === 'subscriptions'
      ? d.map((s: any) => ({
          Clinic: s.tenant.name,
          Plan: s.plan.name,
          Status: s.status,
          Interval: s.interval,
          'Period end': day(s.endsAt),
          'Recurring value': money(s.recurringPaise),
        }))
      : screen === 'saas-payments'
        ? d.map((i: any) => ({
            Invoice: i.id.slice(0, 8),
            Clinic: i.tenantId.slice(0, 8),
            Date: day(i.createdAt),
            Subtotal: money(i.subtotalPaise),
            Tax: money(i.taxPaise),
            Total: money(i.totalPaise),
            Status: i.status,
          }))
        : d.map((a: any) => ({
            Action: a.action,
            Actor: a.actorId.slice(0, 8),
            Clinic: a.tenantId?.slice(0, 8) || 'Platform',
            Date: new Date(a.createdAt).toLocaleString('en-IN'),
            Details: JSON.stringify(a.details),
          }));
  return (
    <>
      <PageTitle
        title={
          screen === 'subscriptions'
            ? 'Subscriptions'
            : screen === 'saas-payments'
              ? 'SaaS invoices & payments'
              : 'Platform audit trail'
        }
        subtitle={
          screen === 'audit'
            ? 'Privileged actions are recorded with actor, clinic and time.'
            : 'Software customer billing stays separate from patient finances.'
        }
      >
        {screen === 'saas-payments' && (
          <button
            className="primary"
            onClick={() =>
              action(
                () => api('/platform/reconcile', 'POST', {}),
                'Provider reconciliation completed. Review invoice statuses and audit history.',
              ).catch(() => {})
            }
          >
            <Activity size={16} /> Reconcile payments
          </button>
        )}
      </PageTitle>
      <SimpleTable rows={rows} />
    </>
  );
}
function CouponList({ tick }: any) {
  const { data, error } = useData('/platform/coupons', tick);
  return !data ? (
    <DataError error={error} />
  ) : (
    <SimpleTable
      rows={data.map((c: any) => ({
        Code: c.code,
        Discount: `${c.percent}%`,
        Expires: day(c.expiresAt),
        Active: c.active ? 'Yes' : 'No',
      }))}
    />
  );
}
function SimpleTable({ rows }: any) {
  return (
    <section className="panel">
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {Object.keys(rows[0]).map((k) => (
                  <th key={k}>{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => (
                <tr key={i}>
                  {Object.entries(r).map(([k, v]) => (
                    <td key={k}>{k === 'Status' ? <Badge value={String(v)} /> : String(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty />
      )}
    </section>
  );
}
function planModal(modal: any, action: any, p?: any) {
  modal({
    title: p ? 'Edit subscription plan' : 'Create subscription plan',
    subtitle: 'Prices are in rupees. Use null for unlimited limits in the JSON configuration.',
    fields: [
      { key: 'name', label: 'Plan name', value: p?.name, required: true },
      {
        key: 'monthlyPaise',
        label: 'Monthly price (₹)',
        type: 'money',
        value: p?.monthlyPaise / 100,
        required: true,
      },
      {
        key: 'annualPaise',
        label: 'Annual price (₹)',
        type: 'money',
        value: p?.annualPaise / 100,
        required: true,
      },
      {
        key: 'trialDays',
        label: 'Trial days',
        type: 'number',
        value: p?.trialDays ?? 14,
        required: true,
      },
      {
        key: 'graceDays',
        label: 'Grace days',
        type: 'number',
        value: p?.graceDays ?? 3,
        required: true,
      },
      {
        key: 'available',
        label: 'Available for new subscriptions',
        type: 'checkbox',
        value: p?.available ?? true,
      },
      {
        key: 'limits',
        label: 'Usage limits (JSON)',
        type: 'textarea',
        value: JSON.stringify(
          p?.limits || {
            doctors: 2,
            staff: 3,
            branches: 1,
            patients: null,
            storageBytes: 1073741824,
          },
          null,
          2,
        ),
        required: true,
      },
      {
        key: 'features',
        label: 'Feature entitlements (JSON)',
        type: 'textarea',
        value: JSON.stringify(
          p?.features || {
            export: false,
            customBranding: false,
            advancedReports: false,
            advancedCommissions: false,
            prioritySupport: false,
          },
          null,
          2,
        ),
        required: true,
      },
    ],
    submit: ({ limits, features, ...data }: any) =>
      action(() =>
        api(p ? `/platform/plans/${p.id}` : '/platform/plans', p ? 'PATCH' : 'POST', {
          ...data,
          limits: JSON.parse(limits),
          features: JSON.parse(features),
        }),
      ),
  });
}
function PublicSite({ plans, settings, screen, setScreen, signedIn }: any) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [info, setInfo] = useState(''),
    [devToken, setDevToken] = useState('');
  useEffect(() => {
    setError('');
  }, [screen]);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data: any = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError('');
    try {
      if (screen === 'login') {
        await api('/auth/login', 'POST', data);
        await signedIn();
      } else if (screen === 'signup') {
        data.acceptTerms = data.acceptTerms === 'on';
        const r = await api('/auth/register', 'POST', data);
        setScreen('login');
        setInfo(r.message);
        setDevToken('');
      } else if (screen === 'verify') {
        const r = await api('/auth/verify', 'POST', data);
        setInfo(r.message);
      } else if (screen === 'forgot') {
        const r = await api('/auth/forgot', 'POST', data);
        setInfo(r.message);
        setDevToken(r.developmentToken || '');
      } else if (screen === 'reset') {
        const r = await api('/auth/reset', 'POST', data);
        setInfo(r.message);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const link = (s: string) => () => {
    setInfo('');
    setDevToken('');
    setScreen(s);
  };
  return (
    <div className="public-site">
      <header className="public-header">
        <button className="logo-button" onClick={link('home')}>
          <Logo name={settings.productName} />
        </button>
        <nav>
          <a
            href="/#features"
            onClick={(e) => {
              e.preventDefault();
              setScreen('features');
            }}
          >
            Features
          </a>
          <a
            href="/#pricing"
            onClick={(e) => {
              e.preventDefault();
              setScreen('pricing');
            }}
          >
            Pricing
          </a>
          <button onClick={link('about')}>About</button>
          <button onClick={link('contact')}>Contact</button>
        </nav>
        <div>
          <button className="text-button" onClick={link('login')}>
            Log in <ArrowRight size={15} />
          </button>
          <button className="primary" onClick={link('signup')}>
            Start free trial
          </button>
        </div>
      </header>
      {screen === 'home' ? (
        <>
          <section className="hero">
            <div className="hero-copy">
              <span className="hero-kicker">
                <span className="live-dot" />A healthier way to run your clinic
              </span>
              <h1>
                More smiles.
                <br />
                Less busywork.
                <br />
                <em>Better care.</em>
              </h1>
              <p>
                Your patients, appointments, treatments and billing — beautifully connected in one
                secure workspace. Built for dental clinics. Ready to grow with you.
              </p>
              <div className="hero-actions">
                <button className="primary" onClick={link('signup')}>
                  Start your free trial <ArrowUpRight size={18} />
                </button>
                <a className="secondary" href="#features">
                  Explore DentaFlow <ArrowRight size={17} />
                </a>
              </div>
              <div className="hero-trust">
                <span>
                  <CheckCircle2 size={16} />
                  No card needed for trial
                </span>
                <span>
                  <ShieldCheck size={16} />
                  Independent clinic workspaces
                </span>
              </div>
            </div>
            <div className="hero-visual">
              <span className="visual-orbit orbit-one" />
              <span className="visual-orbit orbit-two" />
              <div className="hero-floating top">
                <span className="metric-icon mint">
                  <ShieldCheck size={20} />
                </span>
                <div>
                  <strong>Your clinic. Your data.</strong>
                  <small>Protected tenant workspaces</small>
                </div>
              </div>
              <div className="hero-demo">
                <div className="demo-top">
                  <Logo name={settings.productName} />
                  <span className="demo-label">A glimpse of your day</span>
                </div>
                <h3>
                  Care comes first.
                  <br />
                  <span>Everything else, connected.</span>
                </h3>
                <div className="demo-cards">
                  <div>
                    <Users size={18} />
                    <strong>Patients</strong>
                    <small>A complete care story</small>
                  </div>
                  <div>
                    <CalendarDays size={18} />
                    <strong>Appointments</strong>
                    <small>A calmer, clearer day</small>
                  </div>
                </div>
                <div className="demo-visit">
                  <span className="avatar">AS</span>
                  <div>
                    <strong>A smile in the making</strong>
                    <small>Treatment plan · Tooth 36</small>
                  </div>
                  <span className="badge accepted">Connected care</span>
                </div>
                <div className="demo-steps">
                  <span>
                    <Check size={13} />
                    Consultation
                  </span>
                  <i />
                  <span>
                    <Check size={13} />
                    Treatment
                  </span>
                  <i />
                  <span>Follow-up</span>
                </div>
              </div>
              <div className="hero-floating bottom">
                <span className="metric-icon peach">
                  <HeartPulse size={20} />
                </span>
                <div>
                  <strong>Every tooth. Every visit.</strong>
                  <small>One connected patient record</small>
                </div>
                <Sparkles size={21} />
              </div>
              <span className="hero-decoration">✦</span>
            </div>
          </section>
          <div className="feature-ribbon">
            <span>BUILT AROUND YOUR CARE</span>
            <span>
              <HeartPulse size={18} />
              Dental EMR
            </span>
            <span>
              <Smile size={18} />
              Interactive tooth chart
            </span>
            <span>
              <Wallet size={18} />
              Installment billing
            </span>
            <span>
              <Building2 size={18} />
              Multiple clinic workspaces
            </span>
          </div>
          <section id="features" className="marketing-section">
            <span className="eyebrow">ONE WORKSPACE. A WORLD OF DIFFERENCE.</span>
            <h2>
              Everything your clinic needs.
              <br />
              <em>Nothing between you and your patients.</em>
            </h2>
            <div className="feature-grid">
              {[
                [
                  Users,
                  'Know the person behind the smile',
                  'Keep patient details, medical history, documents and clinical notes connected.',
                ],
                [
                  Smile,
                  'A clear picture of every tooth',
                  'Interactive FDI charting with permanent and primary dentition and saved versions.',
                ],
                [
                  HeartPulse,
                  'Care that follows a plan',
                  'Tooth-wise treatment planning, multiple sessions and session-based patient invoices.',
                ],
                [
                  Wallet,
                  'Billing with a little more flexibility',
                  'Record installments, track balances, print invoices and accrue doctor commissions.',
                ],
                [
                  CalendarDays,
                  'A more thoughtful clinic day',
                  'Schedule visits, prevent doctor conflicts and keep follow-ups on your radar.',
                ],
                [
                  ShieldCheck,
                  'Your workspace, your boundaries',
                  'Verified sign-in, staff permissions and tenant-scoped access on the server.',
                ],
              ].map(([Icon, title, desc]: any) => (
                <article key={title}>
                  <span className="feature-icon">
                    <Icon size={24} />
                  </span>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </article>
              ))}
            </div>
          </section>
          <section id="pricing" className="marketing-section pricing-section">
            <span className="eyebrow">GROW AT YOUR OWN PACE</span>
            <h2>A plan for your next chapter.</h2>
            <p>
              Simple monthly pricing. Annual options available in your workspace. Taxes shown at
              checkout.
            </p>
            <div className="pricing-grid">
              {plans.map((p: any) => (
                <PlanCard plan={p} key={p.id} onClick={link('signup')} />
              ))}
            </div>
          </section>
          <section className="marketing-cta">
            <Sparkles size={28} />
            <h2>Make more room for what matters.</h2>
            <p>Your next chapter of patient care starts here.</p>
            <button className="primary" onClick={link('signup')}>
              Start your free trial <ArrowRight size={17} />
            </button>
          </section>
        </>
      ) : ['login', 'signup', 'verify', 'forgot', 'reset'].includes(screen) ? (
        <section className="auth-layout">
          <div className="auth-story">
            <span className="eyebrow">YOUR CLINIC, BEAUTIFULLY CONNECTED</span>
            <h1>
              A little less admin.
              <br />A lot more <em>care.</em>
            </h1>
            <p>One place for your patients, your team and every smile along the way.</p>
            <div className="auth-illustration">
              <Smile size={110} strokeWidth={0.8} />
              <span>
                <ShieldCheck size={19} />
                Your clinic workspace stays private.
              </span>
            </div>
          </div>
          <div className="auth-card">
            <span className="eyebrow">
              {screen === 'signup' ? 'LET’S GET YOUR CLINIC SET UP' : 'WELCOME TO DENTAFLOW'}
            </span>
            <h2>
              {screen === 'login'
                ? 'Good to see you again'
                : screen === 'signup'
                  ? 'Start your clinic’s next chapter'
                  : screen === 'verify'
                    ? 'Verify your email'
                    : screen === 'forgot'
                      ? 'Let’s get you back in'
                      : 'Choose a new password'}
            </h2>
            <p>
              {screen === 'signup'
                ? 'Create your independent workspace. No credit card required for trial.'
                : screen === 'verify'
                  ? 'Enter the single-use code sent to your email.'
                  : 'Secure access to your connected clinic.'}
            </p>
            <form onSubmit={submit}>
              {screen === 'signup' && (
                <>
                  <label>
                    Clinic name
                    <input name="clinicName" required autoComplete="organization" />
                  </label>
                  <label>
                    Owner name
                    <input name="name" required autoComplete="name" />
                  </label>
                </>
              )}
              {['login', 'signup', 'forgot'].includes(screen) && (
                <label>
                  Email address
                  <input name="email" type="email" required autoComplete="email" />
                </label>
              )}
              {screen === 'signup' && (
                <label>
                  Phone number
                  <input name="phone" required minLength={8} autoComplete="tel" />
                </label>
              )}
              {['login', 'signup', 'reset'].includes(screen) && (
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={screen === 'login' ? 1 : 12}
                    maxLength={128}
                    autoComplete={screen === 'login' ? 'current-password' : 'new-password'}
                  />
                  {screen !== 'login' && <small>At least 12 characters</small>}
                </label>
              )}
              {['verify', 'reset'].includes(screen) && (
                <label>
                  {screen === 'verify' ? 'Email verification code' : 'Password reset code'}
                  <input name="token" required minLength={64} maxLength={64} />
                </label>
              )}
              {screen === 'signup' && (
                <>
                  <label>
                    Choose your trial plan
                    <select name="planId" required>
                      {plans.map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.trialDays}-day trial
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="checkbox-label">
                    <input name="acceptTerms" type="checkbox" required />I accept the{' '}
                    <button type="button" className="inline-link" onClick={link('terms')}>
                      terms
                    </button>{' '}
                    and{' '}
                    <button type="button" className="inline-link" onClick={link('privacy')}>
                      privacy policy
                    </button>
                    .
                  </label>
                </>
              )}
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              {info && <div className="success-banner">{info}</div>}
              {devToken && (
                <div className="development-token">
                  <strong>Development only — verification code</strong>
                  <code>{devToken}</code>
                  <small>Production requires a configured email provider.</small>
                </div>
              )}
              <button className="primary full-width" disabled={busy}>
                {busy
                  ? 'Please wait…'
                  : screen === 'login'
                    ? 'Sign in to your workspace'
                    : screen === 'signup'
                      ? 'Create clinic workspace'
                      : screen === 'verify'
                        ? 'Verify email'
                        : screen === 'forgot'
                          ? 'Send reset code'
                          : 'Update password'}
                <ArrowRight size={17} />
              </button>
            </form>
            <div className="auth-links">
              {screen === 'login' ? (
                <>
                  <button onClick={link('forgot')}>Forgot password?</button>
                  <span>
                    New to DentaFlow? <button onClick={link('signup')}>Start free trial</button>
                  </span>
                </>
              ) : (
                <button onClick={link('login')}>Back to sign in</button>
              )}
              {screen === 'forgot' && <button onClick={link('reset')}>I have a reset code</button>}
            </div>
          </div>
        </section>
      ) : (
        <section className="marketing-section prose-page">
          <span className="eyebrow">DENTAFLOW</span>
          <h1>
            {screen === 'about'
              ? 'Designed around better care'
              : screen === 'contact'
                ? 'Let’s talk about your clinic'
                : screen === 'privacy'
                  ? 'Privacy & data ownership'
                  : 'Terms of service'}
          </h1>
          {screen === 'about' ? (
            <>
              <p>
                DentaFlow brings dental patient care and clinic administration into one connected
                workspace. Each clinic has its own patients, team, treatment plans, financial
                records and settings.
              </p>
              <p>
                Built for independent practices and growing clinic groups, with a separate platform
                workspace for the software business.
              </p>
              <button className="primary" onClick={link('signup')}>
                Start a free trial <ArrowRight size={17} />
              </button>
            </>
          ) : screen === 'contact' ? (
            <>
              <p>
                For onboarding, plan questions or product support, reach out to our support team.
              </p>
              <a
                className="primary"
                href={`mailto:${settings.supportEmail || 'support@example.com'}`}
              >
                {settings.supportEmail || 'Support email not configured'}
              </a>
              <p>{settings.supportPhone}</p>
            </>
          ) : screen === 'privacy' ? (
            <>
              <p>
                Clinic records belong to the clinic. DentaFlow separates clinic workspaces and
                restricts record access using authenticated membership and staff permissions.
              </p>
              <h3>Information stored</h3>
              <p>
                Account details, patient records supplied by clinics, appointments, treatment
                documentation, billing entries, documents and security audit events. Platform
                administrators manage subscription metadata; they do not automatically access
                clinical records.
              </p>
              <h3>Exports and retention</h3>
              <p>
                Authorized clinic owners can export records when their plan permits it. Subscription
                expiry does not automatically delete data. Account closure is reviewed with export,
                backup retention and applicable contractual obligations before deletion.
              </p>
              <h3>Deployment policy</h3>
              <p>
                The operator must publish its final privacy policy, retention durations, processor
                list and privacy contact before collecting real patient data.
              </p>
              {settings.privacyUrl && (
                <a href={settings.privacyUrl}>
                  Operator privacy policy <ArrowUpRight size={15} />
                </a>
              )}
            </>
          ) : (
            <>
              <p>
                Each subscription provides access to a clinic workspace under its configured plan,
                usage limits and billing interval. Trials expire at the stated date. Paid access
                follows the configured grace period.
              </p>
              <h3>Payments and cancellation</h3>
              <p>
                Software subscriptions are billed separately from patient payments. Paid
                subscription activation requires a verified provider event or an audited manual
                activation. Cancellation stops access at period end; it does not silently delete
                clinic records.
              </p>
              <h3>Clinical responsibility</h3>
              <p>
                Licensed professionals remain responsible for the accuracy of clinical records and
                treatment decisions. The operator must finalize commercial terms, tax treatment,
                support commitments and refund policies before launch.
              </p>
              {settings.termsUrl && (
                <a href={settings.termsUrl}>
                  Operator terms <ArrowUpRight size={15} />
                </a>
              )}
            </>
          )}
        </section>
      )}
      <footer className="public-footer">
        <Logo name={settings.productName} />
        <p>A little less admin. A little more care.</p>
        <div>
          <button onClick={link('privacy')}>Privacy policy</button>
          <button onClick={link('terms')}>Terms of service</button>
          <button onClick={link('contact')}>Contact</button>
        </div>
        <small>© {new Date().getFullYear()} DentaFlow</small>
      </footer>
    </div>
  );
}
function SupportGrants({ tick, modal, action, platform = false }: any) {
  const base = platform ? '/platform' : '/subscription';
  const { data: grants, error } = useData(`${base}/support-grants`, tick);
  const { data: actor } = useData('/auth/me', 0);
  const create = async () => {
    const patients = await options('patients');
    modal({
      title: 'Authorize patient-scoped support',
      subtitle:
        'The named administrator can read a clinical summary for ONE patient, for up to 24 hours. Every read is audited. You can revoke access at any time.',
      fields: [
        { key: 'adminUserId', label: 'Administrator ID (provided by support)', required: true },
        { key: 'patientId', label: 'Patient', type: 'select', options: patients, required: true },
        { key: 'reason', label: 'Documented reason for access', type: 'textarea', required: true },
        {
          key: 'hours',
          label: 'Access duration (hours, maximum 24)',
          type: 'number',
          value: 1,
          required: true,
        },
        {
          key: 'consent',
          label: 'I explicitly authorize this clinical summary access',
          type: 'checkbox',
          value: false,
        },
      ],
      button: 'Grant temporary access',
      submit: (d: any) => action(() => api('/subscription/support-grants', 'POST', d)),
    });
  };
  return (
    <section className="panel section-gap">
      <div className="panel-heading">
        <div>
          <h2>Controlled support access</h2>
          <p>
            {platform
              ? `Your administrator ID: ${actor?.userId || 'Loading…'}`
              : 'Explicit owner consent, one patient, limited duration, complete audit history.'}
          </p>
        </div>
        {!platform && (
          <button className="secondary small" onClick={() => create().catch(() => {})}>
            <ShieldCheck size={15} />
            Authorize support
          </button>
        )}
      </div>
      {error ? (
        <DataError error={error} />
      ) : grants?.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Patient scope</th>
                <th>Reason</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g: any) => (
                <tr key={g.id}>
                  <td>{g.patientId?.slice(0, 8) || 'Unscoped (unusable)'}</td>
                  <td>{g.reason}</td>
                  <td>{new Date(g.expiresAt).toLocaleString('en-IN')}</td>
                  <td>
                    <Badge
                      value={
                        g.revoked
                          ? 'Revoked'
                          : new Date(g.expiresAt) <= new Date()
                            ? 'EXPIRED'
                            : 'ACTIVE'
                      }
                    />
                  </td>
                  <td>
                    {platform ? (
                      <button
                        className="secondary small"
                        disabled={
                          g.revoked ||
                          g.adminUserId !== actor?.userId ||
                          new Date(g.expiresAt) <= new Date()
                        }
                        onClick={async () => {
                          try {
                            const summary = await api(`/platform/support-access/${g.id}`);
                            modal({
                              title: 'Authorized clinical summary',
                              subtitle: JSON.stringify(summary, null, 2),
                              fields: [],
                              submit: async () => {},
                            });
                          } catch (e: any) {
                            modal({
                              title: 'Support authorization denied',
                              subtitle: e.message,
                              fields: [],
                              submit: async () => {},
                            });
                          }
                        }}
                      >
                        Read authorized summary
                      </button>
                    ) : (
                      !g.revoked && (
                        <button
                          className="secondary small"
                          onClick={() =>
                            action(
                              () => api(`/subscription/support-grants/${g.id}`, 'DELETE'),
                              'Support access revoked',
                            ).catch(() => {})
                          }
                        >
                          Revoke
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="panel-body muted">
          No temporary support authorizations. Administrators have no automatic clinical access.
        </p>
      )}
    </section>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
