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
