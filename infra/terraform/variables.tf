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

variable "domain_name" {
  description = "The one canonical domain, dns.tf. The tenant's own explicit decision (2026-09-17), resolving what used to be an inconsistent .co.za/.co.ls mix across this repo — see dns.tf's own top comment for the real DNS-cutover risk to read before ever pointing a registrar's nameservers at this zone."
  type        = string
  default     = "mytrima.co.za"
}

variable "app_instance_type" {
  description = <<-EOT
    EC2 instance type for the single pilot-stage app instance (compute.tf) —
    the "no app-hosting compute exists yet" gap network.tf's own comment
    flagged. t4g.small (2 vCPU, 2 GiB), not t4g.micro (1 GiB): the app
    instance runs the Docker daemon PLUS the NestJS process, and 1 GiB is
    genuinely tight for that combination — the same "don't lowball a number
    that might actually fail" discipline as this project's own cost
    estimates elsewhere. US on-demand baseline is a confirmed $12.264/month
    (economize.cloud, cross-checked against Vantage/CloudPrice); af-south-1
    isn't directly confirmed for EC2 the way db.t4g.micro is in
    hosting-cost-comparison.md, so applying that same document's own
    observed ~25-30% Cape Town premium on RDS compute gives an ESTIMATED
    ~$15-16/month here — flagged as an estimate, not a confirmed line item,
    same honesty standard as that document's own storage/Redis figures.
  EOT
  type        = string
  default     = "t4g.small"
}
