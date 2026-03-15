variable "project" {
  description = "Project name"
  type        = string
  default     = "hyperlocal"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-south-1"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.20.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDRs"
  type        = list(string)
  default     = ["10.20.0.0/20", "10.20.16.0/20"]
}

variable "private_subnet_cidrs" {
  description = "Private subnet CIDRs"
  type        = list(string)
  default     = ["10.20.32.0/20", "10.20.48.0/20"]
}

variable "db_instance_class" {
  type        = string
  default     = "db.r6g.large"
}

variable "db_username" {
  type        = string
  default     = "appuser"
}

variable "db_password" {
  type        = string
  sensitive   = true
}

variable "redis_node_type" {
  type        = string
  default     = "cache.r6g.large"
}

variable "opensearch_instance_type" {
  type        = string
  default     = "r6g.large.search"
}
