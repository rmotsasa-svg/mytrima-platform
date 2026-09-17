# S3 bucket names are globally unique across all of AWS, not just this
# account — suffixing with the account id is the standard way to
# guarantee that without a random suffix that would make the bucket name
# unpredictable (this needs to be typed, verbatim, into ../terraform's
# backend block — see this stack's own top comment).
resource "aws_s3_bucket" "terraform_state" {
  bucket = "${var.project_name}-terraform-state-${var.aws_account_id}"

  # Real safety net, not the default: an accidental `terraform destroy`
  # against THIS stack would otherwise silently delete every past state
  # file the main stack depends on to know what it already created.
  lifecycle {
    prevent_destroy = true
  }
}

# Versioning: state history survives a bad apply/manual edit — you can
# recover the previous state file, not just the current one.
resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# State (and now ses-smtp-credentials.tf's own real secret inside it)
# must never be reachable publicly — this is the same real, not
# theoretical, risk that file's own comment flagged.
resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket                  = aws_s3_bucket.terraform_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# S3-native locking (via a "*.tflock" conditional-write, Terraform's own
# newer `use_lockfile` backend option) is real but ties Terraform's own
# minimum version higher than this project currently pins (>= 1.5) — a
# DynamoDB lock table is the well-established, works-with-any-1.x
# Terraform choice, and this bucket/table are both one-time, low-traffic
# resources where DynamoDB's own small on-demand cost is immaterial.
resource "aws_dynamodb_table" "terraform_lock" {
  name         = "${var.project_name}-terraform-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID" # Terraform's own required attribute name for this table shape — not a free choice.

  attribute {
    name = "LockID"
    type = "S"
  }
}
