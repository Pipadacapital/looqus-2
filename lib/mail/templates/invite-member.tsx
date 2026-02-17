import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'

interface InviteMemberEmailProps {
  workspaceName: string
  inviterName: string
  inviteeEmail: string
  role: string
  acceptUrl: string
  expiresInDays?: number
}

export function InviteMemberEmail({
  workspaceName = 'Acme Inc.',
  inviterName = 'John Doe',
  inviteeEmail = 'user@example.com',
  role = 'Viewer',
  acceptUrl = 'https://app.example.com/invite/abc123',
  expiresInDays = 7,
}: InviteMemberEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {inviterName} invited you to join {workspaceName} on Shopify Analytics
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={logoSection}>
            <div style={logoBox}>S</div>
          </Section>

          <Heading style={heading}>
            You&apos;ve been invited to join a workspace
          </Heading>

          <Text style={paragraph}>
            <strong>{inviterName}</strong> has invited you to join{' '}
            <strong>{workspaceName}</strong> as a <strong>{role}</strong> on
            Shopify Analytics.
          </Text>

          <Section style={buttonSection}>
            <Button style={button} href={acceptUrl}>
              Accept invitation
            </Button>
          </Section>

          <Text style={secondaryText}>
            This invitation was sent to{' '}
            <span style={{ color: '#111827' }}>{inviteeEmail}</span>. It will
            expire in {expiresInDays} days.
          </Text>

          <Hr style={hr} />

          <Text style={footerText}>
            If you weren&apos;t expecting this invitation, you can safely ignore
            this email.
          </Text>

          <Text style={footerText}>
            Shopify Analytics &mdash; E-commerce intelligence for growing brands
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export default InviteMemberEmail

// ─── Styles ──────────────────────────────────────────────────────────────────

const body: React.CSSProperties = {
  backgroundColor: '#f9fafb',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  margin: 0,
  padding: 0,
}

const container: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '12px',
  border: '1px solid #e5e7eb',
  margin: '40px auto',
  padding: '40px 32px',
  maxWidth: '480px',
}

const logoSection: React.CSSProperties = {
  textAlign: 'center' as const,
  marginBottom: '24px',
}

const logoBox: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#18181b',
  color: '#ffffff',
  fontSize: '20px',
  fontWeight: 700,
  width: '44px',
  height: '44px',
  lineHeight: '44px',
  borderRadius: '10px',
  textAlign: 'center' as const,
}

const heading: React.CSSProperties = {
  color: '#111827',
  fontSize: '20px',
  fontWeight: 600,
  lineHeight: '28px',
  textAlign: 'center' as const,
  margin: '0 0 16px',
}

const paragraph: React.CSSProperties = {
  color: '#4b5563',
  fontSize: '15px',
  lineHeight: '24px',
  textAlign: 'center' as const,
  margin: '0 0 24px',
}

const buttonSection: React.CSSProperties = {
  textAlign: 'center' as const,
  marginBottom: '24px',
}

const button: React.CSSProperties = {
  backgroundColor: '#18181b',
  borderRadius: '8px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '14px',
  fontWeight: 600,
  lineHeight: '1',
  padding: '12px 24px',
  textDecoration: 'none',
  textAlign: 'center' as const,
}

const secondaryText: React.CSSProperties = {
  color: '#6b7280',
  fontSize: '13px',
  lineHeight: '20px',
  textAlign: 'center' as const,
  margin: '0 0 24px',
}

const hr: React.CSSProperties = {
  borderColor: '#e5e7eb',
  margin: '0 0 16px',
}

const footerText: React.CSSProperties = {
  color: '#9ca3af',
  fontSize: '12px',
  lineHeight: '18px',
  textAlign: 'center' as const,
  margin: '0 0 8px',
}
