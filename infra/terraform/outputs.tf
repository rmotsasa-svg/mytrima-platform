output "postgres_endpoint" {
  description = "RDS connection endpoint, in address:port format."
  value       = aws_db_instance.postgres.endpoint
}

output "postgres_master_user_secret_arn" {
  description = "ARN of the Secrets Manager secret RDS created and manages for the master password. Fetch the actual password from Secrets Manager at runtime (e.g. via the AWS SDK, or your compute platform's native secret-injection) — never from Terraform state or output, and never hardcode it."
  value       = aws_db_instance.postgres.master_user_secret[0].secret_arn
}

output "redis_primary_endpoint" {
  description = "ElastiCache Redis primary endpoint address (connect on port 6379, over TLS — see transit_encryption_mode in elasticache.tf)."
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "app_instance_id" {
  description = "The app instance's own id — for connecting via SSM Session Manager (aws ssm start-session --target <this>), not SSH."
  value       = aws_instance.app.id
}

output "app_public_ip" {
  description = "The app instance's stable public IP (an Elastic IP — survives the instance being replaced). api.mytrima.co.za already points here (dns.tf)."
  value       = aws_eip.app.public_ip
}

output "route53_name_servers" {
  description = <<-EOT
    The 4 real nameservers Route53 assigned this zone. Update mytrima.co.za's
    NS records at its registrar to exactly these before this zone's records
    (including the API/SES ones) take effect anywhere. Per dns.tf's own top
    comment: do NOT do this until this zone also has the domain's EXISTING
    mail/other records recreated in it — cutting over nameservers to an
    incomplete zone breaks whatever currently relies on the old ones (real
    email included).
  EOT
  value       = aws_route53_zone.primary.name_servers
}

# aws_ses_domain_identity genuinely exposes no verification-status
# attribute to output (checked against the real provider schema, not
# assumed) — check verification via `aws ses get-identity-verification-
# attributes --identities mytrima.co.za` or the SES console instead. It
# won't show verified immediately after apply either way: Route53 has to
# propagate the TXT/CNAME records above and SES has to notice them first.

output "ses_smtp_credentials_secret_arn" {
  description = "ARN of the Secrets Manager secret holding SES_SMTP_USERNAME/SES_SMTP_PASSWORD (ses-smtp-credentials.tf). Fetch the actual values from Secrets Manager at runtime — never from here or Terraform state; see that file's own top comment."
  value       = aws_secretsmanager_secret.ses_smtp.arn
}
