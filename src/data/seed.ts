import type {
  Alert,
  Asset,
  AttackProfile,
  Cve,
  GeoPoint,
  IntelItem,
  LogWindow,
  RelevanceStatus,
  RiskLevel,
  SourceHealth,
  Technique,
  TrafficPoint,
} from '../lib/types'
import { relevanceReason, round1, scoreAlert } from '../lib/scoring'
import { mulberry32 } from '../lib/stats'

export const DEMO_NOW = new Date('2026-10-31T09:42:00Z')
export const DEMO_NOW_ISO = DEMO_NOW.toISOString()

const hoursAgo = (hours: number) => new Date(DEMO_NOW.getTime() - hours * 3600 * 1000).toISOString()
const daysAgo = (days: number) => new Date(DEMO_NOW.getTime() - days * 86400 * 1000).toISOString()

export const cves: Cve[] = [
  {
    id: 'CVE-2021-44228',
    title: 'Log4Shell: JNDI lookup remote code execution',
    description:
      'Apache Log4j2 does not protect against attacker-controlled LDAP and other JNDI related endpoints. A remote attacker who can control log messages or parameters can execute arbitrary code loaded from remote servers.',
    published: '2021-12-10T10:15:00Z',
    modified: '2025-09-18T04:12:00Z',
    cvss: 10,
    vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H',
    severity: 'CRITICAL',
    cwe: ['CWE-502', 'CWE-20'],
    epss: 0.9755,
    epssPercentile: 0.999,
    kev: true,
    kevDue: '2021-12-24T00:00:00Z',
    vendor: 'Apache',
    product: 'Log4j',
    range: { startIncluding: '2.0-beta9', endExcluding: '2.15.0' },
    fixVersion: '2.17.1 or later',
    refs: [
      { url: 'https://nvd.nist.gov/vuln/detail/CVE-2021-44228', source: 'NVD' },
      { url: 'https://logging.apache.org/log4j/2.x/security.html', source: 'Apache' },
      { url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', source: 'CISA KEV' },
    ],
  },
  {
    id: 'CVE-2021-45046',
    title: 'Log4j2 incomplete JNDI fix',
    description:
      'The fix for Log4Shell was incomplete in certain non-default configurations. Logging crafted data can allow attackers to cause denial of service or remote code execution.',
    published: '2021-12-14T13:30:00Z',
    modified: '2025-07-22T08:40:00Z',
    cvss: 9,
    vector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:C/C:H/I:H/A:H',
    severity: 'CRITICAL',
    cwe: ['CWE-502'],
    epss: 0.942,
    epssPercentile: 0.998,
    kev: true,
    kevDue: '2022-01-07T00:00:00Z',
    vendor: 'Apache',
    product: 'Log4j',
    range: { startIncluding: '2.0-beta9', endExcluding: '2.16.0' },
    fixVersion: '2.16.0 or later',
    refs: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2021-45046', source: 'NVD' }],
  },
  {
    id: 'CVE-2021-45105',
    title: 'Log4j2 denial of service via uncontrolled recursion',
    description:
      'Apache Log4j2 does not always protect from infinite recursion in lookup evaluation, allowing a denial of service when a crafted string is logged.',
    published: '2021-12-18T14:15:00Z',
    modified: '2024-11-21T01:10:00Z',
    cvss: 5.9,
    vector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H',
    severity: 'MEDIUM',
    cwe: ['CWE-674'],
    epss: 0.12,
    epssPercentile: 0.85,
    kev: false,
    vendor: 'Apache',
    product: 'Log4j',
    range: { startIncluding: '2.0-beta9', endExcluding: '2.17.0' },
    fixVersion: '2.17.1 or later',
    refs: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2021-45105', source: 'NVD' }],
  },
  {
    id: 'CVE-2022-22965',
    title: 'Spring4Shell: data binding remote code execution',
    description:
      'A Spring MVC or WebFlux application running on JDK 9 and deployed as a WAR on Tomcat may be vulnerable to remote code execution through crafted data binding.',
    published: '2022-03-31T20:15:00Z',
    modified: '2025-06-14T09:20:00Z',
    cvss: 9.8,
    vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    severity: 'CRITICAL',
    cwe: ['CWE-94', 'CWE-20'],
    epss: 0.941,
    epssPercentile: 0.996,
    kev: true,
    kevDue: '2022-04-25T00:00:00Z',
    vendor: 'VMware',
    product: 'Spring Framework',
    range: { startIncluding: '5.3.0', endExcluding: '5.3.18' },
    fixVersion: '5.3.18 or 5.2.20',
    refs: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2022-22965', source: 'NVD' }],
  },
  {
    id: 'CVE-2023-20863',
    title: 'Spring Framework SpEL denial of service',
    description:
      'A maliciously crafted Spring Expression Language expression can cause denial of service in applications parsing user-supplied expressions.',
    published: '2023-04-13T16:15:00Z',
    modified: '2024-08-05T12:00:00Z',
    cvss: 6.5,
    vector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:H',
    severity: 'MEDIUM',
    cwe: ['CWE-400'],
    epss: 0.09,
    epssPercentile: 0.79,
    kev: false,
    vendor: 'VMware',
    product: 'Spring Framework',
    range: { startIncluding: '5.3.0', endExcluding: '5.3.27' },
    fixVersion: '5.3.27 or 6.0.8',
    refs: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2023-20863', source: 'NVD' }],
  },
  {
    id: 'CVE-2023-34362',
    title: 'MOVEit Transfer SQL injection',
    description:
      'A SQL injection vulnerability in Progress MOVEit Transfer could allow an unauthenticated attacker to access the database and execute altered or disclosed information.',
    published: '2023-06-02T14:15:00Z',
    modified: '2025-10-02T11:30:00Z',
    cvss: 9.8,
    vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    severity: 'CRITICAL',
    cwe: ['CWE-89'],
    epss: 0.974,
    epssPercentile: 0.998,
    kev: true,
    kevDue: '2023-06-23T00:00:00Z',
    vendor: 'Progress',
    product: 'MOVEit Transfer',
    range: { endExcluding: '2023.0.2' },
    fixVersion: '2023.0.2 or later',
    refs: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2023-34362', source: 'NVD' }],
  },
  {
    id: 'CVE-2023-4966',
    title: 'Citrix Bleed: NetScaler session token disclosure',
    description:
      'Sensitive information disclosure in Citrix NetScaler ADC and NetScaler Gateway when configured as a Gateway or AAA virtual server. Session tokens can be exposed.',
    published: '2023-10-10T19:15:00Z',
    modified: '2025-08-19T10:00:00Z',
    cvss: 9.4,
    vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    severity: 'CRITICAL',
    cwe: ['CWE-119'],
    epss: 0.941,
    epssPercentile: 0.997,
    kev: true,
    kevDue: '2023-10-25T00:00:00Z',
    vendor: 'Citrix',
    product: 'NetScaler ADC',
    range: { endExcluding: '13.1-49.15' },
    fixVersion: '13.1-49.15 or later',
    refs: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2023-4966', source: 'NVD' }],
  },
  {
    id: 'CVE-2024-3094',
    title: 'XZ Utils backdoor in liblzma',
    description:
      'Malicious code was found in the XZ Utils liblzma library. The backdoor could allow a malicious actor to break sshd authentication and gain unauthorised access when linked through libsystemd.',
    published: '2024-03-29T18:15:00Z',
    modified: '2025-04-16T09:15:00Z',
    cvss: 10,
    vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H',
    severity: 'CRITICAL',
    cwe: ['CWE-506'],
    epss: 0.62,
    epssPercentile: 0.97,
    kev: true,
    kevDue: '2024-06-16T00:00:00Z',
    vendor: 'Tukaani',
    product: 'XZ Utils',
    range: { startIncluding: '5.6.0', endExcluding: '5.6.2' },
    fixVersion: '5.6.2 or 5.4.6',
    refs: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2024-3094', source: 'NVD' }],
  },
  {
    id: 'CVE-2021-34527',
    title: 'PrintNightmare: Windows Print Spooler RCE',
    description:
      'A remote code execution vulnerability exists when the Windows Print Spooler service improperly performs privileged file operations. An attacker who successfully exploits this could run arbitrary code with system privileges.',
    published: '2021-07-01T18:00:00Z',
    modified: '2025-01-10T14:30:00Z',
    cvss: 8.8,
    vector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H',
    severity: 'HIGH',
    cwe: ['CWE-269'],
    epss: 0.943,
    epssPercentile: 0.997,
    kev: true,
    kevDue: '2021-07-21T00:00:00Z',
    vendor: 'Microsoft',
    product: 'Windows',
    range: { endExcluding: '10.0.19045' },
    fixVersion: 'the patched build 10.0.19045 or later',
    refs: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2021-34527', source: 'NVD' }],
  },
  {
    id: 'CVE-2024-6387',
    title: 'regreSSHion: OpenSSH signal handler race',
    description:
      'A signal handler race condition in OpenSSH server (sshd) on glibc-based Linux systems may allow unauthenticated remote code execution as root.',
    published: '2024-07-01T13:15:00Z',
    modified: '2025-09-08T07:45:00Z',
    cvss: 8.1,
    vector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H',
    severity: 'HIGH',
    cwe: ['CWE-364'],
    epss: 0.55,
    epssPercentile: 0.96,
    kev: true,
    kevDue: '2024-07-22T00:00:00Z',
    vendor: 'OpenBSD',
    product: 'OpenSSH',
    range: { endExcluding: '9.8' },
    fixVersion: '9.8p1 or later',
    refs: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2024-6387', source: 'NVD' }],
  },
  {
    id: 'CVE-2023-38408',
    title: 'OpenSSH PKCS#11 remote code execution',
    description:
      'A vulnerability in the PKCS#11 feature of OpenSSH ssh-agent may allow remote code execution if a victim agent forwards to a malicious server.',
    published: '2023-07-20T15:15:00Z',
    modified: '2024-09-23T10:20:00Z',
    cvss: 9.8,
    vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    severity: 'CRITICAL',
    cwe: ['CWE-78'],
    epss: 0.12,
    epssPercentile: 0.85,
    kev: false,
    vendor: 'OpenBSD',
    product: 'OpenSSH',
    range: { endExcluding: '9.3p2' },
    fixVersion: '9.3p2 or later',
    refs: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2023-38408', source: 'NVD' }],
  },
  {
    id: 'CVE-2020-1472',
    title: 'Zerologon: Netlogon elevation of privilege',
    description:
      'An elevation of privilege vulnerability exists when an attacker establishes a vulnerable Netlogon secure channel connection to a domain controller using Netlogon Remote Protocol.',
    published: '2020-08-11T18:15:00Z',
    modified: '2024-12-02T16:00:00Z',
    cvss: 10,
    vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H',
    severity: 'CRITICAL',
    cwe: ['CWE-330'],
    epss: 0.97,
    epssPercentile: 0.998,
    kev: true,
    kevDue: '2020-09-01T00:00:00Z',
    vendor: 'Microsoft',
    product: 'Windows Server',
    range: { endExcluding: '10.0.17763' },
    fixVersion: 'the August 2020 security updates',
    refs: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2020-1472', source: 'NVD' }],
  },
  {
    id: 'CVE-2024-3400',
    title: 'PAN-OS GlobalProtect command injection',
    description:
      'A command injection vulnerability in the GlobalProtect feature of Palo Alto Networks PAN-OS allows an unauthenticated attacker to execute arbitrary code with root privileges.',
    published: '2024-04-12T08:15:00Z',
    modified: '2025-10-11T13:00:00Z',
    cvss: 10,
    vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H',
    severity: 'CRITICAL',
    cwe: ['CWE-77'],
    epss: 0.96,
    epssPercentile: 0.998,
    kev: true,
    kevDue: '2024-05-02T00:00:00Z',
    vendor: 'Palo Alto Networks',
    product: 'PAN-OS',
    range: { endExcluding: '11.1.2-h3' },
    fixVersion: '11.1.2-h3 or later',
    refs: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2024-3400', source: 'NVD' }],
  },
  {
    id: 'CVE-2023-44487',
    title: 'HTTP/2 Rapid Reset denial of service',
    description:
      'The HTTP/2 protocol allows a denial of service through rapid stream cancellation. Servers that do not limit stream resets can be exhausted by a small number of connections.',
    published: '2023-10-10T14:15:00Z',
    modified: '2025-05-14T11:10:00Z',
    cvss: 7.5,
    vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H',
    severity: 'HIGH',
    cwe: ['CWE-400'],
    epss: 0.97,
    epssPercentile: 0.998,
    kev: true,
    kevDue: '2023-10-31T00:00:00Z',
    vendor: 'NGINX',
    product: 'nginx',
    range: { endExcluding: '1.25.5' },
    fixVersion: '1.25.5 or later',
    refs: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2023-44487', source: 'NVD' }],
  },
  {
    id: 'CVE-2021-26855',
    title: 'ProxyLogon: Exchange Server SSRF',
    description:
      'A server-side request forgery vulnerability in Microsoft Exchange Server allows an unauthenticated attacker to send arbitrary HTTP requests and authenticate as the Exchange server.',
    published: '2021-03-02T23:15:00Z',
    modified: '2024-10-09T09:00:00Z',
    cvss: 9.8,
    vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    severity: 'CRITICAL',
    cwe: ['CWE-918'],
    epss: 0.97,
    epssPercentile: 0.998,
    kev: true,
    kevDue: '2021-04-16T00:00:00Z',
    vendor: 'Microsoft',
    product: 'Exchange Server',
    range: { endExcluding: '15.2.792.10' },
    fixVersion: '15.2.792.10 or later',
    refs: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2021-26855', source: 'NVD' }],
  },
  {
    id: 'CVE-2023-23397',
    title: 'Outlook reminder elevation of privilege',
    description:
      'A crafted reminder property in Microsoft Outlook can cause the client to send the victim’s NTLM hash to an attacker-controlled server without user interaction.',
    published: '2023-03-14T17:15:00Z',
    modified: '2025-03-21T12:40:00Z',
    cvss: 9.8,
    vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    severity: 'CRITICAL',
    cwe: ['CWE-287'],
    epss: 0.5,
    epssPercentile: 0.96,
    kev: true,
    kevDue: '2023-04-04T00:00:00Z',
    vendor: 'Microsoft',
    product: 'Outlook',
    range: {},
    fixVersion: 'the current Microsoft security updates',
    refs: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2023-23397', source: 'NVD' }],
  },
  {
    id: 'CVE-2023-7024',
    title: 'Chrome WebRTC heap buffer overflow',
    description:
      'A heap buffer overflow in WebRTC in Google Chrome could allow a remote attacker to exploit heap corruption via a crafted HTML page.',
    published: '2023-12-20T22:15:00Z',
    modified: '2024-11-19T14:30:00Z',
    cvss: 8.8,
    vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H',
    severity: 'HIGH',
    cwe: ['CWE-787'],
    epss: 0.06,
    epssPercentile: 0.73,
    kev: false,
    vendor: 'Google',
    product: 'Chrome',
    range: { endExcluding: '119.0.6045.159' },
    fixVersion: '119.0.6045.159 or later',
    refs: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2023-7024', source: 'NVD' }],
  },
  {
    id: 'CVE-2023-5217',
    title: 'Chrome libvpx VP8 encoder heap overflow',
    description:
      'A heap buffer overflow in libvpx in Google Chrome allowed a remote attacker to potentially exploit heap corruption via a crafted HTML page.',
    published: '2023-09-27T19:15:00Z',
    modified: '2024-07-11T15:00:00Z',
    cvss: 8.8,
    vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H',
    severity: 'HIGH',
    cwe: ['CWE-787'],
    epss: 0.03,
    epssPercentile: 0.63,
    kev: false,
    vendor: 'Google',
    product: 'Chrome',
    range: { endExcluding: '117.0.5938.132' },
    fixVersion: '117.0.5938.132 or later',
    refs: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2023-5217', source: 'NVD' }],
  },
]

export const assets: Asset[] = [
  {
    id: 'AST-HR-01',
    name: 'HR Portal',
    type: 'app',
    department: 'People Operations',
    criticality: 'HIGH',
    businessFunction: 'Employee records and payroll requests',
    internetFacing: true,
    sensitivity: 'HIGH',
    source: 'SIMULATED',
    software: [
      { vendor: 'Apache', product: 'Log4j', version: '2.14.1' },
      { vendor: 'NGINX', product: 'nginx', version: '1.24.0' },
    ],
  },
  {
    id: 'AST-FIN-02',
    name: 'Payroll API',
    type: 'app',
    department: 'Finance',
    criticality: 'HIGH',
    businessFunction: 'Salary calculation and disbursement',
    internetFacing: false,
    sensitivity: 'HIGH',
    source: 'SIMULATED',
    software: [{ vendor: 'VMware', product: 'Spring Framework', version: '5.3.17' }],
  },
  {
    id: 'AST-NET-03',
    name: 'VPN Gateway',
    type: 'network',
    department: 'IT Infrastructure',
    criticality: 'HIGH',
    businessFunction: 'Remote workforce access',
    internetFacing: true,
    sensitivity: 'HIGH',
    source: 'SIMULATED',
    software: [{ vendor: 'Citrix', product: 'NetScaler ADC', version: '13.1.47' }],
  },
  {
    id: 'AST-FIN-04',
    name: 'File Transfer Server',
    type: 'server',
    department: 'Finance',
    criticality: 'HIGH',
    businessFunction: 'Partner payroll and invoice exchange',
    internetFacing: true,
    sensitivity: 'HIGH',
    source: 'SIMULATED',
    software: [{ vendor: 'Progress', product: 'MOVEit Transfer', version: '2023.0.1' }],
  },
  {
    id: 'AST-ENG-05',
    name: 'Build Runner',
    type: 'server',
    department: 'Engineering',
    criticality: 'MEDIUM',
    businessFunction: 'CI/CD release pipeline',
    internetFacing: false,
    sensitivity: 'MEDIUM',
    source: 'SIMULATED',
    software: [{ vendor: 'Tukaani', product: 'XZ Utils', version: '5.6.1' }],
  },
  {
    id: 'AST-IT-06',
    name: 'Domain Controller',
    type: 'server',
    department: 'IT Infrastructure',
    criticality: 'HIGH',
    businessFunction: 'Identity and access control',
    internetFacing: false,
    sensitivity: 'HIGH',
    source: 'SIMULATED',
    software: [{ vendor: 'Microsoft', product: 'Windows Server', version: '10.0.14393' }],
  },
  {
    id: 'AST-NET-07',
    name: 'Perimeter Firewall',
    type: 'network',
    department: 'IT Infrastructure',
    criticality: 'MEDIUM',
    businessFunction: 'Network perimeter enforcement',
    internetFacing: true,
    sensitivity: 'HIGH',
    source: 'SIMULATED',
    software: [{ vendor: 'Palo Alto Networks', product: 'PAN-OS', version: 'unknown' }],
  },
  {
    id: 'AST-IT-08',
    name: 'Bastion Host',
    type: 'server',
    department: 'IT Infrastructure',
    criticality: 'MEDIUM',
    businessFunction: 'Privileged administrative access',
    internetFacing: false,
    sensitivity: 'HIGH',
    source: 'SIMULATED',
    software: [{ vendor: 'OpenBSD', product: 'OpenSSH', version: '8.9' }],
  },
  {
    id: 'AST-ENG-09',
    name: 'Edge Proxy',
    type: 'cloud',
    department: 'Engineering',
    criticality: 'MEDIUM',
    businessFunction: 'Public traffic routing',
    internetFacing: true,
    sensitivity: 'MEDIUM',
    source: 'SIMULATED',
    software: [{ vendor: 'NGINX', product: 'nginx', version: '1.25.2' }],
  },
  {
    id: 'AST-IT-10',
    name: 'Mail Gateway',
    type: 'server',
    department: 'IT Infrastructure',
    criticality: 'MEDIUM',
    businessFunction: 'Corporate email delivery',
    internetFacing: true,
    sensitivity: 'MEDIUM',
    source: 'SIMULATED',
    software: [{ vendor: 'Microsoft', product: 'Exchange Server', version: '15.1.2507.6' }],
  },
  {
    id: 'AST-CX-11',
    name: 'Customer Portal',
    type: 'app',
    department: 'Customer Experience',
    criticality: 'HIGH',
    businessFunction: 'Customer self-service',
    internetFacing: true,
    sensitivity: 'HIGH',
    source: 'SIMULATED',
    software: [
      { vendor: 'Apache', product: 'Log4j', version: '2.17.1' },
      { vendor: 'NGINX', product: 'nginx', version: '1.24.0' },
    ],
  },
  {
    id: 'AST-FIN-12',
    name: 'Finance Database',
    type: 'database',
    department: 'Finance',
    criticality: 'HIGH',
    businessFunction: 'Ledger and financial reporting',
    internetFacing: false,
    sensitivity: 'HIGH',
    source: 'SIMULATED',
    software: [{ vendor: 'PostgreSQL', product: 'PostgreSQL', version: '15.4' }],
  },
  {
    id: 'AST-IT-13',
    name: 'Print Server',
    type: 'server',
    department: 'Facilities',
    criticality: 'LOW',
    businessFunction: 'Document printing for staff',
    internetFacing: false,
    sensitivity: 'LOW',
    source: 'SIMULATED',
    software: [{ vendor: 'Microsoft', product: 'Windows', version: '10.0.19045' }],
  },
  {
    id: 'AST-IT-14',
    name: 'Admin Workstation',
    type: 'endpoint',
    department: 'IT Infrastructure',
    criticality: 'MEDIUM',
    businessFunction: 'Administrative console access',
    internetFacing: false,
    sensitivity: 'HIGH',
    source: 'SIMULATED',
    software: [{ vendor: 'Google', product: 'Chrome', version: '118.0.5993.88' }],
  },
  {
    id: 'AST-FAC-15',
    name: 'Lobby Display',
    type: 'endpoint',
    department: 'Facilities',
    criticality: 'LOW',
    businessFunction: 'Visitor information display',
    internetFacing: false,
    sensitivity: 'LOW',
    source: 'SIMULATED',
    software: [{ vendor: 'Google', product: 'Chrome', version: '116.0.5845.96' }],
  },
  {
    id: 'AST-IT-16',
    name: 'Backup NAS',
    type: 'server',
    department: 'IT Infrastructure',
    criticality: 'MEDIUM',
    businessFunction: 'Backup retention',
    internetFacing: false,
    sensitivity: 'HIGH',
    source: 'SIMULATED',
    software: [{ vendor: 'Synology', product: 'DSM', version: '7.2.1' }],
  },
]

export const cveById = Object.fromEntries(cves.map((c) => [c.id, c])) as Record<string, Cve>
export const assetById = Object.fromEntries(assets.map((a) => [a.id, a])) as Record<string, Asset>

interface AlertSpec {
  cveId: string
  assetId: string
  relevance: RelevanceStatus
  hours: number
}

const alertSpecs: AlertSpec[] = [
  { cveId: 'CVE-2021-44228', assetId: 'AST-HR-01', relevance: 'MATCHED', hours: 2 },
  { cveId: 'CVE-2023-34362', assetId: 'AST-FIN-04', relevance: 'MATCHED', hours: 6 },
  { cveId: 'CVE-2023-4966', assetId: 'AST-NET-03', relevance: 'MATCHED', hours: 11 },
  { cveId: 'CVE-2020-1472', assetId: 'AST-IT-06', relevance: 'MATCHED', hours: 18 },
  { cveId: 'CVE-2024-3400', assetId: 'AST-NET-07', relevance: 'VERSION_UNKNOWN', hours: 26 },
  { cveId: 'CVE-2023-44487', assetId: 'AST-ENG-09', relevance: 'MATCHED', hours: 31 },
  { cveId: 'CVE-2023-38408', assetId: 'AST-IT-08', relevance: 'MATCHED', hours: 40 },
  { cveId: 'CVE-2024-6387', assetId: 'AST-IT-08', relevance: 'MATCHED', hours: 47 },
  { cveId: 'CVE-2024-3094', assetId: 'AST-ENG-05', relevance: 'MATCHED', hours: 52 },
  { cveId: 'CVE-2021-45105', assetId: 'AST-HR-01', relevance: 'MATCHED', hours: 61 },
  { cveId: 'CVE-2023-20863', assetId: 'AST-FIN-02', relevance: 'MATCHED', hours: 72 },
  { cveId: 'CVE-2023-7024', assetId: 'AST-IT-14', relevance: 'MATCHED', hours: 84 },
  { cveId: 'CVE-2023-5217', assetId: 'AST-FAC-15', relevance: 'MATCHED', hours: 96 },
  { cveId: 'CVE-2021-34527', assetId: 'AST-IT-13', relevance: 'NOT_AFFECTED', hours: 106 },
  { cveId: 'CVE-2023-23397', assetId: 'AST-IT-10', relevance: 'PRODUCT_ABSENT', hours: 118 },
]

function buildAlert(spec: AlertSpec, index: number): Alert {
  const cve = cveById[spec.cveId]
  const asset = assetById[spec.assetId]
  const result = scoreAlert({
    cve,
    criticality: asset.criticality,
    internetFacing: asset.internetFacing,
    relevance: spec.relevance,
  })

  const installed = asset.software.find((s) => s.product.toLowerCase() === cve.product.toLowerCase())
  const version = installed?.version ?? (spec.relevance === 'PRODUCT_ABSENT' ? 'not installed' : 'unknown')
  const confidence = spec.relevance === 'MATCHED' ? 'HIGH' : spec.relevance === 'VERSION_UNKNOWN' ? 'MEDIUM' : 'LOW'

  const summary =
    spec.relevance === 'MATCHED'
      ? `${cve.title} applies to ${asset.name}: ${cve.product} ${version} falls inside the affected range.`
      : spec.relevance === 'VERSION_UNKNOWN'
        ? `${cve.title} may apply to ${asset.name}; the installed ${cve.product} version could not be verified.`
        : spec.relevance === 'NOT_AFFECTED'
          ? `${asset.name} runs ${cve.product} ${version}, which is outside the affected range.`
          : `${cve.product} is associated with ${asset.name} in the graph, but the product is not in its inventory.`

  const impact = `${asset.businessFunction} depends on ${asset.name}. A successful exploit could interrupt this service and expose ${asset.sensitivity.toLowerCase()}-sensitivity data.`

  const action =
    spec.relevance === 'MATCHED' || spec.relevance === 'VERSION_UNKNOWN'
      ? `Upgrade ${cve.product} on ${asset.name} to ${cve.fixVersion}, then restart the affected service.`
      : `No action required for ${asset.name}; keep the version check in the correlation pipeline.`

  const kevNote = cve.kev && cve.kevDue ? ` CISA KEV remediation was due ${new Date(cve.kevDue).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.` : ''
  const reasoning = result.suppressed
    ? `${relevanceReason[spec.relevance]} The relevance gate zeroes the score; a CVSS-only queue would have ranked it ${result.wouldHaveScored?.toFixed(1)}.${kevNote}`
    : `${result.level} at ${result.score.toFixed(1)}: severity ${round1(result.breakdown.severity_points)} + exploitation ${round1(result.breakdown.exploit_points + result.breakdown.kev_points)} + asset ${round1(result.breakdown.criticality_points + result.breakdown.exposure_points)} + relevance ${round1(result.breakdown.relevance_points)}.${kevNote}`

  return {
    id: `ALR-${String(1000 + index)}`,
    cve,
    asset,
    version,
    relevance: spec.relevance,
    confidence,
    score: result.score,
    level: result.level,
    suppressed: result.suppressed,
    suppressionReason: result.suppressed ? relevanceReason[spec.relevance] : undefined,
    wouldHaveScored: result.wouldHaveScored,
    dataIncomplete: result.dataIncomplete,
    breakdown: result.breakdown,
    summary,
    impact,
    action,
    reasoning,
    generatedBy: 'template',
    createdAt: hoursAgo(spec.hours),
    entities: [cve.product, version !== 'unknown' && version !== 'not installed' ? version : '', ...cve.cwe].filter(Boolean),
  }
}

export const alerts: Alert[] = alertSpecs.map(buildAlert)
export const activeAlerts = alerts.filter((a) => !a.suppressed)
export const suppressedAlerts = alerts.filter((a) => a.suppressed)

export const alertById = Object.fromEntries(alerts.map((a) => [a.id, a])) as Record<string, Alert>

export const counts = {
  total: alerts.length,
  active: activeAlerts.length,
  suppressed: suppressedAlerts.length,
  critical: activeAlerts.filter((a) => a.level === 'CRITICAL').length,
  high: activeAlerts.filter((a) => a.level === 'HIGH').length,
  medium: activeAlerts.filter((a) => a.level === 'MEDIUM').length,
  low: activeAlerts.filter((a) => a.level === 'LOW').length,
  kev: cves.filter((c) => c.kev).length,
  cves: cves.length,
}

export const posture = Math.max(0, 100 - (15 * counts.critical + 6 * counts.high))

export const riskLevels: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

/* ---------- deterministic chart series ---------- */

const rand = mulberry32(20261031)

export interface DailyThreat {
  date: string
  label: string
  newCves: number
  kev: number
}

export const threatDaily: DailyThreat[] = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(DEMO_NOW.getTime() - (29 - i) * 86400000)
  const wave = Math.sin(i / 3.1) * 3 + Math.cos(i / 5.4) * 2
  return {
    date: d.toISOString(),
    label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    newCves: Math.max(2, Math.round(8 + wave + rand() * 7)),
    kev: Math.max(0, Math.round(1 + wave / 3 + rand() * 2)),
  }
})

export interface AlertDay {
  label: string
  critical: number
  high: number
  medium: number
  low: number
}

export const alertDaily: AlertDay[] = Array.from({ length: 8 }, (_, i) => {
  const dayStart = new Date(DEMO_NOW.getTime() - (7 - i) * 86400000)
  dayStart.setUTCHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart.getTime() + 86400000)
  const inDay = alerts.filter((a) => {
    const t = new Date(a.createdAt).getTime()
    return t >= dayStart.getTime() && t < dayEnd.getTime()
  })
  return {
    label: dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    critical: inDay.filter((a) => a.level === 'CRITICAL').length,
    high: inDay.filter((a) => a.level === 'HIGH').length,
    medium: inDay.filter((a) => a.level === 'MEDIUM').length,
    low: inDay.filter((a) => a.level === 'LOW').length,
  }
})

export const activityHeatmap = Array.from({ length: 7 }, (_, day) =>
  Array.from({ length: 24 }, (_, hour) => {
    const business = hour >= 8 && hour <= 18 ? 18 : 3
    const spike = (day === 2 || day === 4) && hour >= 1 && hour <= 4 ? 34 : 0
    return Math.round(business + spike + rand() * 14)
  }),
)

export const epssHistory = [
  { id: 'CVE-2021-44228', color: '#e5545a' },
  { id: 'CVE-2023-34362', color: '#e08a2f' },
  { id: 'CVE-2020-1472', color: '#e6c229' },
  { id: 'CVE-2024-3094', color: '#3ed2c1' },
].map(({ id, color }) => {
  const base = cveById[id].epss ?? 0.3
  const points = Array.from({ length: 30 }, (_, i) => {
    const drift = base * (0.72 + (i / 29) * 0.28)
    const noise = (rand() - 0.5) * 0.035
    const d = new Date(DEMO_NOW.getTime() - (29 - i) * 86400000)
    return {
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: Math.min(1, Math.max(0, drift + noise)),
    }
  })
  return { id, color, points }
})

export const sourceHealth: SourceHealth[] = [
  {
    source: 'NVD',
    status: 'OK',
    lastSuccess: hoursAgo(2.1),
    records: 24816,
    note: '2.0 API · cached responses',
    kind: 'real',
  },
  {
    source: 'CISA KEV',
    status: 'OK',
    lastSuccess: hoursAgo(3.4),
    records: 1422,
    note: 'known exploited catalog',
    kind: 'real',
  },
  {
    source: 'FIRST EPSS',
    status: 'OK',
    lastSuccess: hoursAgo(0.75),
    records: 241903,
    note: 'daily scoring batch',
    kind: 'real',
  },
  {
    source: 'MITRE ATT&CK',
    status: 'SIMULATED',
    lastSuccess: hoursAgo(27),
    records: 196,
    note: 'trimmed offline subset',
    kind: 'simulated',
  },
  {
    source: 'CERT-In',
    status: 'DEGRADED',
    lastSuccess: hoursAgo(76),
    records: 12,
    note: 'sample feed · CIAD-SAMPLE only',
    kind: 'simulated',
  },
]

export const intelItems: IntelItem[] = [
  {
    id: 'INT-001',
    source: 'NVD',
    title: 'NVD enriches CVE-2024-3400 with vendor advisory references',
    summary: 'Configuration nodes now include PAN-OS GlobalProtect ranges and the vendor fix mapping.',
    category: 'Vulnerability enrichment',
    published: hoursAgo(2.2),
    url: 'https://nvd.nist.gov/vuln/detail/CVE-2024-3400',
  },
  {
    id: 'INT-002',
    source: 'CISA KEV',
    title: 'CISA KEV entry remains open for CVE-2023-4966',
    summary: 'Known exploited vulnerability due date has passed; asset-level remediation is overdue.',
    category: 'Exploitation',
    published: hoursAgo(3.5),
    url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
  },
  {
    id: 'INT-003',
    source: 'FIRST EPSS',
    title: 'EPSS daily batch refreshed for 241,903 CVEs',
    summary: 'Probability of exploitation in the next 30 days, scored at 04:15 UTC.',
    category: 'Exploitation likelihood',
    published: hoursAgo(0.9),
    url: 'https://www.first.org/epss/',
  },
  {
    id: 'INT-004',
    source: 'NVD',
    title: 'CVE-2024-3094 analysis notes updated',
    summary: 'CISA and Red Hat references added to the XZ Utils backdoor record.',
    category: 'Vulnerability enrichment',
    published: hoursAgo(9.4),
    url: 'https://nvd.nist.gov/vuln/detail/CVE-2024-3094',
  },
  {
    id: 'INT-005',
    source: 'CERT-In',
    title: 'CIAD-SAMPLE-001 — sample advisory (not a real advisory)',
    summary: 'Demonstration item shipped offline. Clearly labelled sample content for the CERT-In adapter.',
    category: 'Advisory',
    published: hoursAgo(21),
    simulated: true,
  },
  {
    id: 'INT-006',
    source: 'MITRE ATT&CK',
    title: 'Technique mapping refreshed for exploit public-facing applications',
    summary: 'T1190 mappings updated in the local trimmed subset used by the correlation view.',
    category: 'Adversary behaviour',
    published: hoursAgo(27),
    simulated: true,
  },
  {
    id: 'INT-007',
    source: 'NVD',
    title: 'CVE-2021-44228 references include updated Apache advisory',
    summary: 'Record last modified; CVSS v3.1 remains 10.0 with scope changed.',
    category: 'Vulnerability enrichment',
    published: hoursAgo(33),
    url: 'https://nvd.nist.gov/vuln/detail/CVE-2021-44228',
  },
  {
    id: 'INT-008',
    source: 'CISA KEV',
    title: 'KEV adds CVE-2024-3400 to known exploited catalog',
    summary: 'Exploitation observed in the wild; due date recorded for federal remediation.',
    category: 'Exploitation',
    published: hoursAgo(41),
    url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
  },
  {
    id: 'INT-009',
    source: 'FIRST EPSS',
    title: 'EPSS remains above the 99th percentile for Log4Shell',
    summary: 'Probability of exploitation in the next 30 days: 0.9755 on the demo snapshot.',
    category: 'Exploitation likelihood',
    published: hoursAgo(49),
    url: 'https://api.first.org/data/v1/epss?cve=CVE-2021-44228',
  },
  {
    id: 'INT-010',
    source: 'NVD',
    title: 'CVE-2023-34362 configurations include MOVEit Transfer ranges',
    summary: 'CPE match rows expanded to fixed and vulnerable version boundaries.',
    category: 'Vulnerability enrichment',
    published: hoursAgo(58),
    url: 'https://nvd.nist.gov/vuln/detail/CVE-2023-34362',
  },
  {
    id: 'INT-011',
    source: 'CERT-In',
    title: 'CIAD-SAMPLE-002 — sample advisory (not a real advisory)',
    summary: 'Second demonstration item for the degraded source state view.',
    category: 'Advisory',
    published: hoursAgo(70),
    simulated: true,
  },
  {
    id: 'INT-012',
    source: 'MITRE ATT&CK',
    title: 'STIX subset revalidated for offline demo',
    summary: '196 techniques and 10 tactics remain inside the trimmed local bundle.',
    category: 'Adversary behaviour',
    published: hoursAgo(82),
    simulated: true,
  },
]

export const geoPoints: GeoPoint[] = [
  { id: 'geo-us', country: 'United States', iso: 'US', numericId: '840', category: 'Scanning', count: 1840, longitude: -98, latitude: 39 },
  { id: 'geo-cn', country: 'China', iso: 'CN', numericId: '156', category: 'Scanning', count: 1510, longitude: 104, latitude: 35 },
  { id: 'geo-ru', country: 'Russia', iso: 'RU', numericId: '643', category: 'Brute force', count: 1205, longitude: 90, latitude: 60 },
  { id: 'geo-in', country: 'India', iso: 'IN', numericId: '356', category: 'Phishing', count: 780, longitude: 78, latitude: 22 },
  { id: 'geo-de', country: 'Germany', iso: 'DE', numericId: '276', category: 'Scanning', count: 690, longitude: 10, latitude: 51 },
  { id: 'geo-nl', country: 'Netherlands', iso: 'NL', numericId: '528', category: 'Malware C2', count: 640, longitude: 5.5, latitude: 52 },
  { id: 'geo-br', country: 'Brazil', iso: 'BR', numericId: '76', category: 'Brute force', count: 570, longitude: -51, latitude: -10 },
  { id: 'geo-gb', country: 'United Kingdom', iso: 'GB', numericId: '826', category: 'Phishing', count: 520, longitude: -1.5, latitude: 52.5 },
  { id: 'geo-fr', country: 'France', iso: 'FR', numericId: '250', category: 'Scanning', count: 460, longitude: 2.5, latitude: 46.5 },
  { id: 'geo-sg', country: 'Singapore', iso: 'SG', numericId: '702', category: 'Malware C2', count: 430, longitude: 103.8, latitude: 1.35 },
  { id: 'geo-jp', country: 'Japan', iso: 'JP', numericId: '392', category: 'Scanning', count: 390, longitude: 138, latitude: 36 },
  { id: 'geo-ca', country: 'Canada', iso: 'CA', numericId: '124', category: 'Phishing', count: 350, longitude: -106, latitude: 56 },
  { id: 'geo-au', country: 'Australia', iso: 'AU', numericId: '36', category: 'Scanning', count: 300, longitude: 134, latitude: -25 },
  { id: 'geo-ua', country: 'Ukraine', iso: 'UA', numericId: '804', category: 'Brute force', count: 280, longitude: 32, latitude: 49 },
  { id: 'geo-za', country: 'South Africa', iso: 'ZA', numericId: '710', category: 'Phishing', count: 210, longitude: 24, latitude: -29 },
  { id: 'geo-mx', country: 'Mexico', iso: 'MX', numericId: '484', category: 'Brute force', count: 190, longitude: -102, latitude: 23 },
  { id: 'geo-kr', country: 'South Korea', iso: 'KR', numericId: '410', category: 'Malware C2', count: 175, longitude: 127.5, latitude: 36 },
  { id: 'geo-ng', country: 'Nigeria', iso: 'NG', numericId: '566', category: 'Phishing', count: 160, longitude: 8, latitude: 9 },
]

export const anomalyWindows: LogWindow[] = [
  { id: 'W-01', label: 'Mon 09:00', failedLogins: 3, distinctIps: 2, rps: 8, countryNovelty: 0, anomalyScore: -0.12, anomaly: false },
  { id: 'W-02', label: 'Mon 12:00', failedLogins: 2, distinctIps: 2, rps: 11, countryNovelty: 0, anomalyScore: -0.08, anomaly: false },
  { id: 'W-03', label: 'Mon 18:00', failedLogins: 4, distinctIps: 3, rps: 7, countryNovelty: 1, anomalyScore: -0.04, anomaly: false },
  { id: 'W-04', label: 'Tue 02:00', failedLogins: 41, distinctIps: 1, rps: 6, countryNovelty: 2, anomalyScore: 0.42, anomaly: true, reason: 'Brute-force burst from a single IP' },
  { id: 'W-05', label: 'Tue 09:00', failedLogins: 5, distinctIps: 3, rps: 12, countryNovelty: 0, anomalyScore: -0.1, anomaly: false },
  { id: 'W-06', label: 'Tue 15:00', failedLogins: 3, distinctIps: 2, rps: 9, countryNovelty: 0, anomalyScore: -0.14, anomaly: false },
  { id: 'W-07', label: 'Wed 03:00', failedLogins: 18, distinctIps: 6, rps: 54, countryNovelty: 1, anomalyScore: 0.28, anomaly: true, reason: 'Off-hours admin activity with elevated RPS' },
  { id: 'W-08', label: 'Wed 10:00', failedLogins: 4, distinctIps: 3, rps: 10, countryNovelty: 0, anomalyScore: -0.06, anomaly: false },
  { id: 'W-09', label: 'Wed 16:00', failedLogins: 2, distinctIps: 2, rps: 13, countryNovelty: 0, anomalyScore: -0.11, anomaly: false },
  { id: 'W-10', label: 'Thu 01:00', failedLogins: 2, distinctIps: 1, rps: 7, countryNovelty: 3, anomalyScore: 0.36, anomaly: true, reason: 'Login from a country not seen in baseline' },
  { id: 'W-11', label: 'Thu 08:00', failedLogins: 6, distinctIps: 4, rps: 14, countryNovelty: 0, anomalyScore: -0.02, anomaly: false },
  { id: 'W-12', label: 'Thu 14:00', failedLogins: 3, distinctIps: 2, rps: 11, countryNovelty: 0, anomalyScore: -0.09, anomaly: false },
  { id: 'W-13', label: 'Fri 00:00', failedLogins: 1, distinctIps: 1, rps: 6, countryNovelty: 0, anomalyScore: -0.15, anomaly: false },
  { id: 'W-14', label: 'Fri 04:00', failedLogins: 29, distinctIps: 14, rps: 18, countryNovelty: 2, anomalyScore: 0.31, anomaly: true, reason: 'Credential stuffing across many source IPs' },
  { id: 'W-15', label: 'Fri 11:00', failedLogins: 4, distinctIps: 2, rps: 12, countryNovelty: 0, anomalyScore: -0.07, anomaly: false },
  { id: 'W-16', label: 'Fri 17:00', failedLogins: 3, distinctIps: 2, rps: 9, countryNovelty: 0, anomalyScore: -0.1, anomaly: false },
  { id: 'W-17', label: 'Sat 12:00', failedLogins: 1, distinctIps: 1, rps: 4, countryNovelty: 0, anomalyScore: -0.18, anomaly: false },
  { id: 'W-18', label: 'Sat 20:00', failedLogins: 2, distinctIps: 1, rps: 3, countryNovelty: 0, anomalyScore: -0.16, anomaly: false },
]

export const trafficSeries: TrafficPoint[] = Array.from({ length: 48 }, (_, i) => {
  const d = new Date(DEMO_NOW.getTime() - (47 - i) * 30 * 60000)
  const base = 120 + Math.sin(i / 5) * 30 + rand() * 22
  const burst = i >= 30 && i <= 33 ? 620 - (i - 30) * 90 : i >= 38 && i <= 39 ? 420 : 0
  return {
    time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    rps: Math.round(base + burst),
    bytes: Math.round((base + burst) * 4200 + rand() * 80000),
    failed: Math.round(3 + rand() * 8 + (burst ? 34 : 0)),
    anomaly: burst > 0,
    burst: burst > 0,
  }
})

export const mitreTactics = [
  { id: 'TA0001', name: 'Initial Access' },
  { id: 'TA0002', name: 'Execution' },
  { id: 'TA0003', name: 'Persistence' },
  { id: 'TA0004', name: 'Privilege Esc.' },
  { id: 'TA0005', name: 'Defense Evasion' },
  { id: 'TA0006', name: 'Credential Access' },
  { id: 'TA0007', name: 'Discovery' },
  { id: 'TA0008', name: 'Lateral Movement' },
  { id: 'TA0011', name: 'Command & Control' },
  { id: 'TA0040', name: 'Impact' },
]

export const techniques: Technique[] = [
  { id: 'T1190', name: 'Exploit Public-Facing Application', tactic: 'Initial Access', tacticId: 'TA0001', description: 'Adversaries exploit weaknesses in internet-facing applications.', observed: 9 },
  { id: 'T1566', name: 'Phishing', tactic: 'Initial Access', tacticId: 'TA0001', description: 'Malicious messages are used to gain access.', observed: 4 },
  { id: 'T1195', name: 'Supply Chain Compromise', tactic: 'Initial Access', tacticId: 'TA0001', description: 'Manipulation of products or delivery mechanisms.', observed: 2 },
  { id: 'T1059', name: 'Command and Scripting Interpreter', tactic: 'Execution', tacticId: 'TA0002', description: 'Abuse of command interpreters for execution.', observed: 6 },
  { id: 'T1203', name: 'Exploitation for Client Execution', tactic: 'Execution', tacticId: 'TA0002', description: 'Exploitation of client application vulnerabilities.', observed: 3 },
  { id: 'T1053', name: 'Scheduled Task/Job', tactic: 'Execution', tacticId: 'TA0002', description: 'Scheduled execution for persistence or triggers.', observed: 2 },
  { id: 'T1505', name: 'Server Software Component', tactic: 'Persistence', tacticId: 'TA0003', description: 'Abuse of server extensibility for persistence.', observed: 3 },
  { id: 'T1136', name: 'Create Account', tactic: 'Persistence', tacticId: 'TA0003', description: 'Creation of accounts to maintain access.', observed: 1 },
  { id: 'T1543', name: 'Create or Modify System Process', tactic: 'Persistence', tacticId: 'TA0003', description: 'System-level process manipulation.', observed: 2 },
  { id: 'T1068', name: 'Exploitation for Privilege Escalation', tactic: 'Privilege Esc.', tacticId: 'TA0004', description: 'Exploiting software flaws to elevate privileges.', observed: 5 },
  { id: 'T1548', name: 'Abuse Elevation Control Mechanism', tactic: 'Privilege Esc.', tacticId: 'TA0004', description: 'Bypassing elevation controls.', observed: 2 },
  { id: 'T1070', name: 'Indicator Removal', tactic: 'Defense Evasion', tacticId: 'TA0005', description: 'Deleting or altering artifacts.', observed: 2 },
  { id: 'T1562', name: 'Impair Defenses', tactic: 'Defense Evasion', tacticId: 'TA0005', description: 'Disabling or modifying security tools.', observed: 3 },
  { id: 'T1027', name: 'Obfuscated Files or Information', tactic: 'Defense Evasion', tacticId: 'TA0005', description: 'Obfuscation of payloads or data.', observed: 4 },
  { id: 'T1110', name: 'Brute Force', tactic: 'Credential Access', tacticId: 'TA0006', description: 'Password guessing and credential spraying.', observed: 8 },
  { id: 'T1003', name: 'OS Credential Dumping', tactic: 'Credential Access', tacticId: 'TA0006', description: 'Extraction of credentials from operating systems.', observed: 3 },
  { id: 'T1557', name: 'Adversary-in-the-Middle', tactic: 'Credential Access', tacticId: 'TA0006', description: 'Interception of network traffic.', observed: 1 },
  { id: 'T1046', name: 'Network Service Discovery', tactic: 'Discovery', tacticId: 'TA0007', description: 'Enumeration of network services.', observed: 7 },
  { id: 'T1082', name: 'System Information Discovery', tactic: 'Discovery', tacticId: 'TA0007', description: 'Collection of system configuration details.', observed: 4 },
  { id: 'T1021', name: 'Remote Services', tactic: 'Lateral Movement', tacticId: 'TA0008', description: 'Use of remote services to move laterally.', observed: 4 },
  { id: 'T1570', name: 'Lateral Tool Transfer', tactic: 'Lateral Movement', tacticId: 'TA0008', description: 'Transfer of tools between systems.', observed: 2 },
  { id: 'T1071', name: 'Application Layer Protocol', tactic: 'Command & Control', tacticId: 'TA0011', description: 'C2 over common application protocols.', observed: 3 },
  { id: 'T1105', name: 'Ingress Tool Transfer', tactic: 'Command & Control', tacticId: 'TA0011', description: 'Bringing tools into the environment.', observed: 2 },
  { id: 'T1041', name: 'Exfiltration Over C2 Channel', tactic: 'Impact', tacticId: 'TA0040', description: 'Exfiltration over an existing C2 channel.', observed: 2 },
  { id: 'T1486', name: 'Data Encrypted for Impact', tactic: 'Impact', tacticId: 'TA0040', description: 'Encryption of data to disrupt availability.', observed: 4 },
  { id: 'T1498', name: 'Network Denial of Service', tactic: 'Impact', tacticId: 'TA0040', description: 'Degradation or denial of network availability.', observed: 5 },
  { id: 'T1489', name: 'Service Stop', tactic: 'Impact', tacticId: 'TA0040', description: 'Stopping services to disrupt operations.', observed: 2 },
]

export const attackProfiles: AttackProfile[] = [
  {
    key: 'ddos',
    name: 'DDoS',
    category: 'Availability',
    description: 'Volumetric or application-layer traffic designed to exhaust a public service.',
    defaultSeverity: 'HIGH',
    techniques: ['T1498', 'T1190'],
    stages: [
      { tactic: 'Resource Development', note: 'Botnet capacity is rented' },
      { tactic: 'Reconnaissance', note: 'Public endpoints are profiled' },
      { tactic: 'Initial Access', note: 'HTTP/2 stream abuse starts' },
      { tactic: 'Impact', note: 'Edge capacity is exhausted' },
    ],
    mitigations: [
      { control: 'Enable provider DDoS scrubbing and rate limits', team: 'Network' },
      { control: 'Patch the edge proxy for HTTP/2 Rapid Reset', team: 'Platform' },
      { control: 'Define service-level degradation playbooks', team: 'SRE' },
    ],
    indicators: ['Sudden RPS above 3σ', 'Concentrated reset floods', 'High bytes with low session duration'],
  },
  {
    key: 'phishing',
    name: 'Phishing',
    category: 'Initial access',
    description: 'Deceptive messages that deliver credential theft, links, or malware.',
    defaultSeverity: 'HIGH',
    techniques: ['T1566', 'T1203'],
    stages: [
      { tactic: 'Reconnaissance', note: 'Employee details are harvested' },
      { tactic: 'Initial Access', note: 'A lure is delivered by email' },
      { tactic: 'Credential Access', note: 'Credentials are captured' },
      { tactic: 'Exfiltration', note: 'Mailbox content is reviewed' },
    ],
    mitigations: [
      { control: 'Enforce phishing-resistant MFA', team: 'Identity' },
      { control: 'Tune mail gateway link detonation', team: 'Security' },
      { control: 'Run targeted reporting drills', team: 'Awareness' },
    ],
    indicators: ['New sender domain', 'Reply-to mismatch', 'Link-to-display mismatch'],
  },
  {
    key: 'ransomware',
    name: 'Ransomware',
    category: 'Impact',
    description: 'Encryption and extortion after lateral movement through exposed systems.',
    defaultSeverity: 'CRITICAL',
    techniques: ['T1486', 'T1021', 'T1003'],
    stages: [
      { tactic: 'Initial Access', note: 'A public application is exploited' },
      { tactic: 'Execution', note: 'A loader runs on the host' },
      { tactic: 'Persistence', note: 'A service is modified' },
      { tactic: 'Lateral Movement', note: 'Remote services are abused' },
      { tactic: 'Impact', note: 'Backups and data are encrypted' },
    ],
    mitigations: [
      { control: 'Patch KEV-listed internet-facing systems first', team: 'IT' },
      { control: 'Keep offline and immutable backups', team: 'Infrastructure' },
      { control: 'Segment backup and identity networks', team: 'Network' },
    ],
    indicators: ['Volume shadow copy deletion', 'Mass file rename events', 'Credential dumping tooling'],
  },
  {
    key: 'malware',
    name: 'Malware',
    category: 'Execution',
    description: 'Malicious tooling that establishes persistence, C2, and data access.',
    defaultSeverity: 'HIGH',
    techniques: ['T1059', 'T1071', 'T1543'],
    stages: [
      { tactic: 'Execution', note: 'Script interpreter is abused' },
      { tactic: 'Persistence', note: 'A system process is modified' },
      { tactic: 'Command & Control', note: 'Beaconing begins over HTTPS' },
      { tactic: 'Exfiltration', note: 'Data is staged externally' },
    ],
    mitigations: [
      { control: 'Restrict outbound traffic to allow-lists', team: 'Network' },
      { control: 'Hunt for unsigned services and scheduled jobs', team: 'SOC' },
      { control: 'Enable endpoint tamper protection', team: 'IT' },
    ],
    indicators: ['New service creation', 'Regular beacon intervals', 'Unusual parent-child processes'],
  },
  {
    key: 'sqli',
    name: 'SQL Injection',
    category: 'Application',
    description: 'Injected queries that read or alter data through an exposed application.',
    defaultSeverity: 'CRITICAL',
    techniques: ['T1190', 'T1005'],
    stages: [
      { tactic: 'Reconnaissance', note: 'Parameters are probed' },
      { tactic: 'Initial Access', note: 'Injection bypasses validation' },
      { tactic: 'Collection', note: 'Sensitive tables are queried' },
      { tactic: 'Exfiltration', note: 'Records are extracted' },
    ],
    mitigations: [
      { control: 'Patch MOVEit Transfer and similar file transfer software', team: 'Application' },
      { control: 'Use parameterised queries everywhere', team: 'Engineering' },
      { control: 'Rate-limit public SQL error surfaces', team: 'Platform' },
    ],
    indicators: ['SQL error strings in responses', 'UNION payloads in access logs', 'Bulk SELECT volume'],
  },
  {
    key: 'bruteforce',
    name: 'Brute Force',
    category: 'Credential access',
    description: 'High-volume password guessing aimed at exposed login surfaces.',
    defaultSeverity: 'MEDIUM',
    techniques: ['T1110', 'T1078'],
    stages: [
      { tactic: 'Reconnaissance', note: 'Login endpoints are found' },
      { tactic: 'Credential Access', note: 'Password guessing starts' },
      { tactic: 'Initial Access', note: 'A weak password succeeds' },
      { tactic: 'Discovery', note: 'Access is expanded' },
    ],
    mitigations: [
      { control: 'Throttle failed authentication by source and account', team: 'Identity' },
      { control: 'Block legacy authentication protocols', team: 'Identity' },
      { control: 'Alert on failure-rate z-scores above 2', team: 'SOC' },
    ],
    indicators: ['Failed login spikes', 'Single source IP', 'Repeated usernames'],
  },
  {
    key: 'stuffing',
    name: 'Credential Stuffing',
    category: 'Credential access',
    description: 'Replayed credential pairs tested across many source addresses.',
    defaultSeverity: 'HIGH',
    techniques: ['T1110', 'T1078'],
    stages: [
      { tactic: 'Resource Development', note: 'Credential corpus is acquired' },
      { tactic: 'Credential Access', note: 'Distributed replay begins' },
      { tactic: 'Initial Access', note: 'Valid accounts are identified' },
      { tactic: 'Collection', note: 'Account data is reviewed' },
    ],
    mitigations: [
      { control: 'Deploy device-bound sessions and MFA', team: 'Identity' },
      { control: 'Detect distributed low-and-slow failures', team: 'SOC' },
      { control: 'Check passwords against breach corpora', team: 'Security' },
    ],
    indicators: ['Many IPs, few failures each', 'Uniform user agents', 'Successful login after low failures'],
  },
  {
    key: 'supplychain',
    name: 'Supply Chain',
    category: 'Initial access',
    description: 'Compromise of a dependency, update channel, or build pipeline.',
    defaultSeverity: 'CRITICAL',
    techniques: ['T1195', 'T1105'],
    stages: [
      { tactic: 'Resource Development', note: 'A dependency is compromised' },
      { tactic: 'Initial Access', note: 'A malicious release is installed' },
      { tactic: 'Execution', note: 'Build or login code executes' },
      { tactic: 'Impact', note: 'Distributed trust is abused' },
    ],
    mitigations: [
      { control: 'Remove affected XZ Utils versions from build images', team: 'Platform' },
      { control: 'Pin dependencies and verify provenance', team: 'Engineering' },
      { control: 'Reproduce builds in isolated runners', team: 'DevOps' },
    ],
    indicators: ['Dependency version drift', 'Unexpected build network egress', 'Unsigned artifacts'],
  },
  {
    key: 'xss',
    name: 'Cross-site Scripting',
    category: 'Application',
    description: 'Script injection into pages viewed by other users.',
    defaultSeverity: 'MEDIUM',
    techniques: ['T1059', 'T1203'],
    stages: [
      { tactic: 'Reconnaissance', note: 'Input reflection is identified' },
      { tactic: 'Initial Access', note: 'A payload is injected' },
      { tactic: 'Credential Access', note: 'Session material is stolen' },
      { tactic: 'Exfiltration', note: 'Data leaves the browser' },
    ],
    mitigations: [
      { control: 'Adopt a strict Content Security Policy', team: 'Engineering' },
      { control: 'Escape output by context', team: 'Engineering' },
      { control: 'Mark session cookies HttpOnly and SameSite', team: 'Platform' },
    ],
    indicators: ['Script tags in query strings', 'CSP violations', 'Unexpected third-party frames'],
  },
  {
    key: 'insider',
    name: 'Insider Exfiltration',
    category: 'Data loss',
    description: 'Authorised access used to remove sensitive information.',
    defaultSeverity: 'HIGH',
    techniques: ['T1041', 'T1005', 'T1114'],
    stages: [
      { tactic: 'Collection', note: 'Sensitive records are gathered' },
      { tactic: 'Defense Evasion', note: 'Logs and labels are altered' },
      { tactic: 'Exfiltration', note: 'Data leaves through an allowed channel' },
      { tactic: 'Impact', note: 'Confidentiality is lost' },
    ],
    mitigations: [
      { control: 'Apply data-loss prevention to file transfer', team: 'Security' },
      { control: 'Alert on bulk export of finance records', team: 'SOC' },
      { control: 'Review privileged access quarterly', team: 'Compliance' },
    ],
    indicators: ['Off-hours bulk access', 'Large outbound transfers', 'Unusual file-share patterns'],
  },
]

export const componentCatalog = [
  { id: 1, name: 'Security Dashboard', tagline: 'The command centre: posture, alerts, and exposure in one view.', group: 'Command', icon: 'gauge' },
  { id: 2, name: 'Alert Center', tagline: 'Version-aware, explained alerts with acknowledgement.', group: 'Command', icon: 'bell' },
  { id: 3, name: 'Risk Scoring', tagline: 'The exact formula, weights, and a live ranking preview.', group: 'Command', icon: 'sliders' },
  { id: 4, name: 'Network Graph', tagline: 'Follow the path from an exposed asset to a critical system.', group: 'Investigation', icon: 'network' },
  { id: 5, name: 'Attack Profiles', tagline: 'Lifecycle, techniques, and mitigations for ten attack types.', group: 'Investigation', icon: 'swords' },
  { id: 6, name: 'Asset Exposure', tagline: 'Which systems are exposed, and how much they matter.', group: 'Assets & Vulnerabilities', icon: 'server' },
  { id: 7, name: 'CVE Explorer', tagline: 'Real CVE records with readable affected ranges.', group: 'Assets & Vulnerabilities', icon: 'search' },
  { id: 8, name: 'Threat Intel Feed', tagline: 'Source health, timeline, and provenance for each item.', group: 'Threat Intelligence', icon: 'rss' },
  { id: 9, name: 'Anomaly Detection', tagline: 'Behaviour deviations in logs, with model evidence.', group: 'Operations & Analytics', icon: 'activity' },
  { id: 10, name: 'What-If Simulator', tagline: 'Patch, expose, or add assets without touching the base data.', group: 'Scenarios', icon: 'flask' },
  { id: 11, name: 'ATT&CK Matrix', tagline: 'Map observed behaviour to real ATT&CK techniques.', group: 'Operations & Analytics', icon: 'grid' },
  { id: 12, name: 'Global Threat Map', tagline: 'Country-level patterns, clearly labelled as illustrative.', group: 'Threat Intelligence', icon: 'globe' },
  { id: 13, name: 'Provenance Graph', tagline: 'Every input that produced an alert, present or missing.', group: 'Investigation', icon: 'gitBranch' },
  { id: 14, name: 'Emerging Radar', tagline: 'EPSS movement, KEV additions, and acceleration.', group: 'Threat Intelligence', icon: 'radar' },
  { id: 15, name: 'Traffic Analytics', tagline: 'Requests, bursts, entropy, and protocol mix.', group: 'Operations & Analytics', icon: 'barChart' },
  { id: 16, name: 'Data Input Hub', tagline: 'Upload inventory and logs, map, validate, accept.', group: 'Data', icon: 'upload' },
  { id: 17, name: 'AI Analyst', tagline: 'A dedicated copilot page for workspace evidence and general questions.', group: 'Assistant', icon: 'sparkles' },
]

export const sampleAssetsCsv = `asset_name,asset_type,owner_department,criticality,business_function,internet_facing,data_sensitivity,software_vendor,software_product,software_version
Warehouse Scanner,server,Logistics,HIGH,Barcode ingestion,false,MEDIUM,Apache,Log4j,2.14.1
Partner Portal,app,Partnerships,MEDIUM,Partner onboarding,true,MEDIUM,Apache,Log4j,2.17.1
Compliance Archive,server,Legal,HIGH,Retention and discovery,false,HIGH,Synology,DSM,7.2.1`

export const sampleLogsCsv = `timestamp,event_type,source_ip,dest_asset,username,user_agent,country_code,protocol,bytes
2026-10-31T02:14:00Z,LOGIN_FAIL,198.51.100.24,HR Portal,jsmith,Mozilla/5.0,US,HTTPS,1420
2026-10-31T02:15:00Z,LOGIN_FAIL,198.51.100.24,HR Portal,jsmith,Mozilla/5.0,US,HTTPS,1380
2026-10-31T02:16:00Z,LOGIN_SUCCESS,198.51.100.24,HR Portal,jsmith,Mozilla/5.0,US,HTTPS,2200
2026-10-31T03:02:00Z,EXPLOIT_SIGNATURE,203.0.113.9,VPN Gateway,unknown,curl/8.4.0,SG,HTTPS,5120`

export const uploadedDatasets = [
  {
    id: 'DS-1001',
    name: 'asset_inventory_q4.csv',
    type: 'Assets',
    status: 'ACCEPTED',
    rows: 64,
    accepted: 61,
    rejected: 3,
    uploadedBy: 'a.rao@aegis.demo',
    uploadedAt: hoursAgo(30),
    source: 'USER UPLOAD',
  },
  {
    id: 'DS-1002',
    name: 'vpn_auth_30d.jsonl',
    type: 'Logs',
    status: 'ACCEPTED',
    rows: 18422,
    accepted: 18390,
    rejected: 32,
    uploadedBy: 'a.rao@aegis.demo',
    uploadedAt: hoursAgo(54),
    source: 'USER UPLOAD',
  },
  {
    id: 'DS-1003',
    name: 'legacy_export.xlsm',
    type: 'Assets',
    status: 'REJECTED',
    rows: 0,
    accepted: 0,
    rejected: 0,
    uploadedBy: 'a.rao@aegis.demo',
    uploadedAt: hoursAgo(96),
    source: 'USER UPLOAD',
  },
]

export const departments = [...new Set(assets.map((a) => a.department))]
