export type DesktopContentSection = {
  title: string;
  description: string;
  items: string[];
};

export type OnlineServiceRow = {
  name: string;
  status: string;
  nextAction: string;
};

export type GeneralLogFieldGroup = {
  title: string;
  fields: string[];
};

export function desktopSettingsSections(): DesktopContentSection[] {
  return [
    {
      title: 'Station Profiles',
      description: 'Web access to operating profiles and station-location snapshots.',
      items: [
        'Show active callsign, grid, county/state, rig, and default report settings.',
        'Add/edit/delete profile workflow will mirror the mobile app after the skeleton is approved.',
        'Profile snapshots should be stamped onto logged QSOs so later edits do not rewrite history.',
      ],
    },
    {
      title: 'Log2Go Backend Account',
      description: 'Account and device status for syncing QSOs with the Log2Go backend.',
      items: [
        'Display logged-in user, device ID, backend URL, and sync status.',
        'Registration/login controls belong here as the web account flow grows.',
        'Keep local/offline logging available when not logged in.',
      ],
    },
    {
      title: 'Online Services',
      description: 'LoTW, QRZ.com, and eQSL.cc account management placeholders.',
      items: [
        'Show configured service accounts and verification status returned by the backend.',
        'Do not store service passwords in browser storage; submit them to the backend for encrypted storage.',
        'Service upload/confirmation status should remain per-QSO and backend-owned.',
      ],
    },
    {
      title: 'Web Storage',
      description: 'Honest storage boundary for this early web build.',
      items: [
        'Current preview persists non-secret app state locally in browser storage.',
        'Real service credentials should be verified and encrypted by the Log2Go backend.',
        'This screen must not imply browser localStorage is secure credential storage.',
      ],
    },
  ];
}

export function onlineServiceRows(): OnlineServiceRow[] {
  return [
    { name: 'LoTW', status: 'Not configured in web preview', nextAction: 'Use backend-backed credential verification and encrypted server-side storage.' },
    { name: 'QRZ.com', status: 'Not configured in web preview', nextAction: 'Use verified backend service-adapter status; do not store credentials in browser storage.' },
    { name: 'eQSL.cc', status: 'Not configured in web preview', nextAction: 'Preserve QTH nickname/account labeling from the backend model.' },
  ];
}

export function generalLogFieldGroups(): GeneralLogFieldGroup[] {
  return [
    { title: 'Contact', fields: ['Callsign', 'Name'] },
    { title: 'Signal & Band', fields: ['Frequency MHz', 'Band', 'Mode', 'RST Sent', 'RST Received'] },
    { title: 'Location', fields: ['Grid', 'State', 'County', 'QTH'] },
    { title: 'Notes', fields: ['Remarks'] },
  ];
}
