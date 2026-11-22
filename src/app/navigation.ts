import { useLocation, useNavigate } from 'react-router-dom';

const pageNames: Record<string, string> = {
  '/': 'Library',
  '/series': 'Series',
  '/stats': 'Stats',
  '/private-mode': 'Private mode',
  '/settings': 'Settings',
  '/privacy-policy': 'Privacy Policy',
  '/about': 'About',
  '/read': 'Reader',
};

const tabs = ['/', '/series', '/stats', '/private-mode'];

export function getAppTab(path: string): string | undefined {
  return tabs.find((tab) => path === tab || (tab !== '/' && path.startsWith(`${tab}/`)));
}

export function getAppNavigationState(pathname: string) {
  return { previousAppPage: pathname };
}

function getPageName(path: string): string | undefined {
  const root = getAppTab(path) ?? `/${path.split('/')[1] ?? ''}`;
  return Object.hasOwn(pageNames, root) ? pageNames[root] : undefined;
}

export function useAppBack() {
  const location = useLocation();
  const navigate = useNavigate();
  const previous: unknown = location.state?.previousAppPage;
  const previousName = typeof previous === 'string' && previous !== location.pathname ? getPageName(previous) : undefined;

  return {
    backLabel: `Back to ${previousName ?? 'Library'}`,
    goBack: () => {
      if (previousName) navigate(-1);
      else navigate('/', { replace: true });
    },
  };
}
