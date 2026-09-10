variable "aws_account_id" {
  description = "The one real AWS account this configuration is meant to run against, provided 2026-09-11. Wired into the provider block's own allowed_account_ids below as a safety check — not a resource argument on its own, so it costs nothing and provisions nothing by itself. Its only job is to make Terraform refuse to run at all if it's ever pointed at credentials for a different account (e.g. a personal account, a wrong org member account), rather than silently provisioning real, billed resources somewhere unintended."
  type        = string
  default     = "284460774146"
}

variable "aws_region" {
  description = "AWS region. af-south-1 (Cape Town) per the hosting decision in ../../hosting-cost-comparison.md. NOTE: af-south-1 is an AWS 'opt-in region' — it must be explicitly enabled at the account level (Account → AWS Regions) before Terraform can provision anything here, or the first apply fails with OptInRequired."
  type        = string
  default     = "af-south-1"
}

variable "environment" {
  description = "Deployment environment name, used in resource naming and tagging."
  type        = string
  default     = "pilot"
}

variable "project_name" {
  type    = string
  default = "mytrima"
}

variable "db_instance_class" {
  description = "RDS instance class. db.t4g.micro is the smallest burstable Postgres tier — priced at ~$12/month in af-south-1 in hosting-cost-comparison.md, the tier that comparison was actually costed against."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage_gb" {
  description = "gp3 storage, in GiB. 20 is the practical minimum for RDS Postgres and comfortably covers a 5-10 tenant pilot."
  type        = number
  default     = 20
}

variable "redis_node_type" {
  description = "ElastiCache node type. cache.t4g.micro is the smallest burstable Redis tier priced in hosting-cost-comparison.md."
  type        = string
  default     = "cache.t4g.micro"
}
