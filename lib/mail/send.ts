import { render } from '@react-email/components'
import { transporter, MAIL_FROM } from './transport'
import type { ReactElement } from 'react'

interface SendMailOptions {
  to: string
  subject: string
  template: ReactElement
}

export async function sendMail({ to, subject, template }: SendMailOptions) {
  const html = await render(template)
  const text = await render(template, { plainText: true })

  const result = await transporter.sendMail({
    from: MAIL_FROM,
    to,
    subject,
    html,
    text,
  })

  return result
}
