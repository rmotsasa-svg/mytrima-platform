/**
 * "Let AWS manage it" — the tenant's own explicit instruction, applied to
 * the real SMTP-credential gap dns.tf's own comment deliberately left
 * open ("generate SES SMTP credentials via the AWS console... never
 * here"). As close to RDS's own manage_master_user_password pattern as
 * SES/IAM actually allows — see the honest limitation this can't fully
 * avoid, below.
 *
 * HOW THIS DIFFERS FROM rds.tf's PASSWORD, HONESTLY: RDS's own feature
 * means AWS RDS itself creates and owns that secret — Terraform never
 * computes or sees it, so it can never appear in Terraform state.
 * SES/IAM has no equivalent "AWS creates it, Terraform never sees it"
 * mode — an IAM access key can only be created BY Terraform (or by
 * hand), so the real secret access key and its derived SMTP password
 * (aws_iam_access_key's own `secret`/`ses_smtp_password_v4` attributes)
 * DO pass through this configuration and land in Terraform state, full
 * stop. Both attributes are marked `sensitive` by the provider itself
 * (confirmed against the real schema, not assumed) — that only redacts
 * them from CLI plan/apply output, it does NOT encrypt or remove them
 * from the state file. This is exactly why main.tf's own "no remote
 * state backend" gap matters more now than it did before this file
 * existed: local state on disk is the one place this secret genuinely
 * lives in cleartext. Add the S3 backend main.tf already flags as
 * missing, or at minimum treat the local `terraform.tfstate` file
 * itself as a real secret from this point on (encrypt the disk, restrict
 * who can read it) — don't let this be the thing that makes that gap
 * bite.
 *
 * What this DOES achieve, matching the spirit of "let AWS manage it" as
 * closely as SES/IAM allows: a dedicated IAM user scoped to nothing but
 * sending mail as this one verified identity (not a broad SES:* grant),
 * and the derived credentials pushed straight into Secrets Manager —
 * the app fetches them from there at runtime, the same operational
 * pattern as rds.tf's own master password, even though the creation-time
 * exposure above is real and different.
 */

resource "aws_iam_user" "ses_smtp" {
  name = "${var.project_name}-${var.environment}-ses-smtp"
  tags = local.common_tags
}

data "aws_iam_policy_document" "ses_smtp_send" {
  statement {
    actions   = ["ses:SendRawEmail", "ses:SendEmail"]
    resources = [aws_ses_domain_identity.primary.arn]
  }
}

resource "aws_iam_user_policy" "ses_smtp_send" {
  name   = "${var.project_name}-${var.environment}-ses-send"
  user   = aws_iam_user.ses_smtp.name
  policy = data.aws_iam_policy_document.ses_smtp_send.json
}

resource "aws_iam_access_key" "ses_smtp" {
  user = aws_iam_user.ses_smtp.name
}

resource "aws_secretsmanager_secret" "ses_smtp" {
  name        = "${var.project_name}-${var.environment}-ses-smtp-credentials"
  description = "SES_SMTP_USERNAME/SES_SMTP_PASSWORD for the app — fetch at runtime (AWS SDK, or the compute platform's native secret injection), never from Terraform state or output. See this file's own top comment on why this ISN'T fully equivalent to rds.tf's manage_master_user_password."
  tags        = local.common_tags
}

# ses_smtp_password_v4 is the secret access key already converted into an
# SES SMTP password via AWS's own documented SigV4-based algorithm —
# Terraform's own provider does this conversion; nothing here derives it
# by hand. The SMTP *username* is the access key id itself (SES's own
# convention), not the IAM user's name.
resource "aws_secretsmanager_secret_version" "ses_smtp" {
  secret_id = aws_secretsmanager_secret.ses_smtp.id
  secret_string = jsonencode({
    SES_SMTP_USERNAME = aws_iam_access_key.ses_smtp.id
    SES_SMTP_PASSWORD = aws_iam_access_key.ses_smtp.ses_smtp_password_v4
  })
}
