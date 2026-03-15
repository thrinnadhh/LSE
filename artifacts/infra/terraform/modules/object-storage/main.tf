variable "name_prefix" { type = string }
variable "tags" { type = map(string) }

resource "aws_s3_bucket" "media" {
  bucket = "${var.name_prefix}-media-assets"

  tags = var.tags
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration {
    status = "Enabled"
  }
}

output "media_bucket" {
  value = aws_s3_bucket.media.bucket
}
