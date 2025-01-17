import { Test, TestingModule } from "@nestjs/testing";
import { FilesService } from "./files.service";
import {
  AudioFileEntity,
  SubtitleFileEntity,
  VideoFileEntity,
} from "./entities/file.entity";
import { getRepositoryToken } from "@nestjs/typeorm";
import { promises as fsPromises } from "fs";
import { Repository } from "typeorm";
import { describe } from "node:test";

const videoFile1: any = {
  id: 1,
  fileName: "file1.mp4",
  baseName: "file1",
  extName: ".mp4",
  filePath: "/path/to/file1.mp4",
  status: "active",
  fanart: "/path/to/fanart1.jpg",
  poster: "/path/to/poster1.jpg",
};

const videoFile2 = {
  id: 2,
  fileName: "file2.avi",
  baseName: "file2",
  extName: ".avi",
  filePath: "/path/to/file2.avi",
  status: "active",
  fanart: "/path/to/fanart2.jpg",
  poster: "/path/to/poster2.jpg",
};

const audioFile1: any = {
  id: 1,
  fileName: "file1.mp3",
  baseName: "file1",
  extName: ".mp3",
  filePath: "/path/to/file1.mp3",
  status: "active",
};
const audioFile2: any = {
  id: 2,
  fileName: "file2.flac",
  baseName: "file2",
  extName: ".flac",
  filePath: "/path/to/file2.flac",
  status: "active",
};

const expectedVideoFiles: any = [videoFile1, videoFile2];

describe("FilesService", () => {
  let service: FilesService;
  let mockVideoFileRepo: Partial<jest.Mocked<Repository<VideoFileEntity>>>;
  let mockAudioFileRepo: Partial<jest.Mocked<Repository<AudioFileEntity>>>;
  let mockSubtitleFileRepo: Partial<
    jest.Mocked<Repository<SubtitleFileEntity>>
  >;

  beforeEach(async () => {
    mockSubtitleFileRepo = {
      delete: jest.fn().mockResolvedValue({ raw: { affectedRows: 1 } }),
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
    };

    mockAudioFileRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
    };
    mockVideoFileRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        {
          provide: getRepositoryToken(VideoFileEntity), // Replace 'VideoFileEntity' with your actual entity name
          useValue: mockVideoFileRepo, // Mock the repository methods you need
        },
        {
          provide: getRepositoryToken(AudioFileEntity), // Replace 'AudioFileEntity' with your actual entity name
          useValue: mockAudioFileRepo, // Mock the repository methods you need
        },
        {
          provide: getRepositoryToken(SubtitleFileEntity), // Replace 'SubtitleFileEntity' with your actual entity name
          useValue: mockSubtitleFileRepo, // Mock the repository methods you need
        },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("removeWithPath", () => {
    it("should remove the file and delete the subtitle successfully", async () => {
      // Arrange
      const filePath = "somePath";
      const mockResult = {
        raw: { affectedRows: 1 },
      };
      jest.spyOn(fsPromises, "unlink").mockResolvedValue(undefined);
      mockSubtitleFileRepo.delete.mockResolvedValue(mockResult); // 假设删除成功会返回 { affected: 1 }F

      // Act
      const result = await service.removeWithPath(filePath);

      // Assert
      expect(fsPromises.unlink).toHaveBeenCalledWith(filePath);
      expect(mockSubtitleFileRepo.delete).toHaveBeenCalledWith({
        filePath,
      });
      expect(result).toBe(mockResult);
    });

    it("should throw an error if unlink fails", async () => {
      // Arrange
      const filePath = "somePath";
      jest
        .spyOn(fsPromises, "unlink")
        .mockRejectedValue(new Error("unlink failed"));

      // Act & Assert
      await expect(service.removeWithPath(filePath)).rejects.toThrow(
        "unlink failed"
      );
    });

    it("should throw an error if deleting the subtitle fails", async () => {
      // Arrange
      const filePath = "somePath";
      jest.spyOn(fsPromises, "unlink").mockResolvedValue(undefined);
      mockSubtitleFileRepo.delete.mockRejectedValue(new Error("delete failed"));

      // Act & Assert
      await expect(service.removeWithPath(filePath)).rejects.toThrow(
        "delete failed"
      );
    });
  });

  describe("findVideoFiles", () => {
    it("should find video files", async () => {
      // Arrange

      mockVideoFileRepo.find.mockResolvedValue(expectedVideoFiles);

      // Act
      const result = await service.findVideoFiles();

      // Assert
      expect(result).toBe(expectedVideoFiles);
    });

    it("should find video file by id", async () => {
      mockVideoFileRepo.findOne.mockResolvedValue(videoFile1);

      // Act
      const result = await service.findVideoFile(1);

      // Assert
      expect(result).toBe(videoFile1);
    });

    it("should return related files for video", async () => {
      // Arrange
      const skip = 0;
      const take = 10;

      mockVideoFileRepo.find.mockResolvedValue(expectedVideoFiles);

      // Act
      const result = await service.findRelatedFilesForVideo({ skip, take });

      // Assert
      expect(mockVideoFileRepo.find).toHaveBeenCalledWith({
        relations: ["audioFile", "audioFile.subtitleFiles"],
        skip,
        take,
      });
      expect(result).toEqual(expectedVideoFiles);
    });

    it("should return video count", async () => {
      // Arrange
      const count = 10;
      mockVideoFileRepo.count.mockResolvedValue(count);

      // Act
      const result = await service.videoFilesCount();

      // Assert
      expect(result).toBe(count);
    });
  });

  describe("findAudioFile", () => {
    it("should find audio file by id", async () => {
      // Arrange
      mockAudioFileRepo.findOne.mockResolvedValue(audioFile1);

      // Act
      const result = await service.findAudioFile(1);

      // Assert
      expect(result).toBe(audioFile1);
    });

    it("should find audio files", async () => {
      // Arrange

      const expectedAudioFiles = [audioFile1, audioFile2];
      mockAudioFileRepo.find.mockResolvedValue(expectedAudioFiles);

      // Act
      const result = await service.findAudioFiles();

      // Assert
      expect(result).toBe(expectedAudioFiles);
    });

    it("should find related files for audio", async () => {
      // Arrange
      const skip = 0;
      const take = 10;

      mockAudioFileRepo.find.mockResolvedValue([audioFile1, audioFile2]);

      // Act
      const result = await service.findRelatedFilesForAudio({ skip, take });

      // Assert
      expect(mockAudioFileRepo.find).toHaveBeenCalledWith({
        relations: ["subtitleFiles"],
        skip,
        take,
      });
      expect(result).toEqual([audioFile1, audioFile2]);
    });

    it("should return audio count", async () => {
      // Arrange
      const count = 10;
      mockAudioFileRepo.count.mockResolvedValue(count);

      // Act
      const result = await service.audioFilesCount();

      // Assert
      expect(result).toBe(count);
    });
  });

  describe("findSubtitleFile", () => {
    it("should find subtitle file by id", async () => {
      // Arrange
      const expectedSubtitleFile: any = {
        id: 1,
        fileName: "file1.srt",
        baseName: "file1",
        extName: ".srt",
        filePath: "/path/to/file1.srt",
        status: "active",
      };
      mockSubtitleFileRepo.findOne.mockResolvedValue(expectedSubtitleFile);

      // Act
      const result = await service.findSubtitleFile(1);

      // Assert
      expect(result).toBe(expectedSubtitleFile);
    });

    it("should find subtitle files", async () => {
      // Arrange
      const expectedSubtitleFiles: any = [
        {
          id: 1,
          fileName: "file1.srt",
          baseName: "file1",
          extName: ".srt",
          filePath: "/path/to/file1.srt",
          status: "active",
        },
        {
          id: 2,
          fileName: "file2.srt",
          baseName: "file2",
          extName: ".srt",
          filePath: "/path/to/file2.srt",
          status: "active",
        },
      ];
      mockSubtitleFileRepo.find.mockResolvedValue(expectedSubtitleFiles);

      // Act
      const result = await service.findSubtitleFiles();

      // Assert
      expect(result).toBe(expectedSubtitleFiles);
    });

    it("should return subtitle count", async () => {
      // Arrange
      const count = 10;
      mockSubtitleFileRepo.count.mockResolvedValue(count);

      // Act
      const result = await service.subtitleFilesCount();

      // Assert
      expect(result).toBe(count);
    });
  });
});
