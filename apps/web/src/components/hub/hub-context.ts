'use client';

import * as React from 'react';

/**
 * True inside a hub's tab. The hub names the page above its tabs, so a view's
 * own PageHeader under them carries the description and actions but not the
 * title a second time.
 */
export const InHubContext = React.createContext(false);
