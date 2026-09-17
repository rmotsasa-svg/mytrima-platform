output "state_bucket_name" {
  description = "Paste this exact value into ../terraform's backend \"s3\" block (bucket = ...) — see ../terraform/README.md's own \"Activating this backend\" section."
  value       = aws_s3_bucket.terraform_state.bucket
}

output "lock_table_name" {
  description = "Paste this exact value into ../terraform's backend \"s3\" block (dynamodb_table = ...)."
  value       = aws_dynamodb_table.terraform_lock.name
}
