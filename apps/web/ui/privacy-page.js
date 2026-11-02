// The Privacy page: what Proxi removed from the user's messages, this month and all time.
// privacy.js turns the summary into what the page shows.

import { api } from './api.js';
import { DOCS_URL } from './citations.js';
import { privacyView } from './privacy.js';

const PERIODS = [['month', 'This month'], ['all', 'All time']];

export const privacyState = {
  privacy: null, // the summary from /api/privacy, null while loading, or 'error'
  privacyPeriod: 'month'
};

export function createPrivacyPage(app) {
  const s = app.state;

  async function loadPrivacy() {
    try {
      app.setState({ privacy: await api.get('/api/privacy') });
    } catch {
      app.setState({ privacy: 'error' });
      app.showToast("Couldn't load your privacy summary. Please try again.");
    }
  }

  return {
    views: {
      privacyPage: () => {
        const ready = !!s.privacy && s.privacy !== 'error';
        return {
          openPrivacy: () => { app.go({ view: 'privacy', privacy: null }); loadPrivacy(); },
          isPrivacy: s.view === 'privacy',
          privacyLoading: s.view === 'privacy' && !s.privacy,
          privacyError: s.privacy === 'error',
          privacyReady: ready,
          privacyEmpty: ready && s.privacy.all.total === 0,
          privacyHasData: ready && s.privacy.all.total > 0,
          privacy: ready ? privacyView(s.privacy, s.privacyPeriod) : null,
          privacyRetry: () => { app.setState({ privacy: null }); loadPrivacy(); },
          privacyTabs: PERIODS.map(([id, label]) => ({
            key: id, label, pressed: s.privacyPeriod === id ? 'true' : 'false',
            bg: s.privacyPeriod === id ? 'var(--surface)' : 'transparent',
            color: s.privacyPeriod === id ? 'var(--text)' : 'var(--text-muted-2)',
            weight: s.privacyPeriod === id ? 600 : 500,
            shadow: s.privacyPeriod === id ? '0 1px 2px rgba(24,24,27,0.08)' : 'none',
            pick: () => app.setState({ privacyPeriod: id })
          })),
          privacyDocs: DOCS_URL + '/privacy'
        };
      }
    }
  };
}
