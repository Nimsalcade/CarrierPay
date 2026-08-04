-- CreateTable
CREATE TABLE "LoadAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoadAttachment_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LoadAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LoadAttachment_loadId_idx" ON "LoadAttachment"("loadId");
