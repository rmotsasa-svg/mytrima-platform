/**
 * Mytrima infrastructure — AWS Africa (Cape Town), af-south-1.
 * Per Master Plan Section 4 ("Terraform from day one") and the hosting
 * decision recorded in hosting-cost-comparison.md (2026-09-07).
 *
 * NOT YET APPLIED — same "written, not run" honesty standard as every SQL
 * migration in db/migrations/. Every resource argument below was checked
 * against the AWS provider's own current documentation (not memory) before
 * being written; `terraform validate`/`plan` have not been run against a
 * real AWS account in this environment (that requires AWS credentials this
 * assistant does not have and should not be given — see README.md's
 * "AWS Cape Town vs. Azure South Africa" section on why account creation
 * and credential handling are the user's to do, not this assistant's).
 */

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # KNOWN GAP: local state only. Local state has no locking and is trivial
  # to lose or diverge the moment more than one person (or a CI pipeline)
  # applies this. Add an S3 + DynamoDB-lock backend block here once that
  # bucket/table exists — not created by this configuration itself, to avoid
  # a chicken-and-egg bootstrap problem (the backend needs to exist before
  # Terraform can use it).
}

provider "aws" {
  region = var.aws_region
}
