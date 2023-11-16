import { CreateWatchDto } from "./dto/create-watch.dto";
import { UpdateWatchDto } from "./dto/update-watch.dto";
import { Injectable, OnModuleInit } from "@nestjs/common";
import { Queue } from "bull";
import { InjectQueue } from "@nestjs/bull";
import { basename } from "path";
import * as path from "path";
import * as fs from "fs";
import * as chokidar from "chokidar";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  VideoFileEntity,
  AudioFileEntity,
  SubtitleFileEntity,
  FileEntity,
} from "../entities/file.entity";
import * as fg from "fast-glob";
import * as cheerio from "cheerio";

export interface VideoDirFileGroup {
  videoFile: string;
  audioFiles: string[];
  subtitleFiles: string[];
}

@Injectable()
export class WatchService {
  // 表示是否正在初始化
  private isInitializing: boolean = true;

  constructor(
    @InjectRepository(VideoFileEntity)
    private videoFilesRepository: Repository<VideoFileEntity>,
    @InjectRepository(AudioFileEntity)
    private audioFilesRepository: Repository<AudioFileEntity>,
    @InjectRepository(SubtitleFileEntity)
    private subtitleFilesRepository: Repository<SubtitleFileEntity>,
    @InjectQueue("watchFiles") private fileProcessingQueue: Queue
  ) {}

  private readonly staticDir = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "uploads"
  );
  private readonly videoDir = path.join(this.staticDir, "video");

  private videoExtensions = ["mp4", "mkv", "avi", "mov", "flv", "wmv"];
  private audioExtensions = ["mp3", "wav", "ogg", "flac"];
  private subtitleExtensions = ["srt", "ass"];

  async onModuleInit() {
    this.enqueueFileProcessingJob();
    this.watchFiles();
  }

  handleInitializeFinished() {
    this.isInitializing = false;
  }

  async enqueueFileProcessingJob() {
    // 将任务加入队列
    await this.fileProcessingQueue.add("findAndClassifyFiles", {});
  }

  // async enqueueFileGroupProcessingJob

  private async saveOrUpdateFile(
    filePath: string,
    repo,
    relatedEntities: any = {},
    status = "todo"
  ) {
    const fileName = path.basename(filePath);
    const baseName = path.basename(fileName, path.extname(fileName));
    const extName = path.extname(fileName);

    if (!repo.findOne) {
      throw new Error(
        "Repository is not defined." +
          filePath +
          repo +
          relatedEntities +
          status
      );
    }
    let existsInDb = await repo.findOne({ where: { fileName } });
    if (existsInDb) {
      // 更新状态
      if (status) {
        existsInDb.status = status;

        if (Object.keys(relatedEntities).length === 0) {
          // throw new Error("No fields to update for the entity.");
        } else {
          existsInDb = { ...existsInDb, ...relatedEntities };
        }

        return await repo.save(existsInDb);
      }
    } else {
      // 创建新的记录
      const newFile = repo.create({
        filePath,
        fileName,
        baseName,
        extName,
        status,
        ...relatedEntities,
      });
      return await repo.save(newFile);
    }
  }

  private async saveFilesToDB({ videoFiles, audioFiles, subtitleFiles }) {
    // 遍历字幕文件
    for (const subtitleFile of subtitleFiles) {
      // 如果字幕文件存在，那么对应的音频文件状态应该是 'done'
      const audioFileIndex = audioFiles.findIndex((filePath) =>
        path
          .basename(subtitleFile, path.extname(subtitleFile))
          .includes(path.basename(filePath, path.extname(filePath)))
      );

      const baseName = path.basename(subtitleFile, path.extname(subtitleFile));

      // todo: 优化查询, 通过 baseName 查询audioFile的参数
      // const audioFileInDb = await this.audioFilesRepository
      //   .createQueryBuilder("audioFile")
      //   .where("audioFile.baseName LIKE :baseName", {
      //     baseName: `%${baseName}%`,
      //   })
      //   .getOne();

      await this.saveOrUpdateFile(
        subtitleFile,
        this.subtitleFilesRepository,
        {},
        "done"
      );

      if (audioFileIndex !== -1) {
        const audioFile = audioFiles[audioFileIndex];
        const audioEntity = await this.saveOrUpdateFile(
          audioFile,
          this.audioFilesRepository,
          {},
          "done"
        );

        await this.saveOrUpdateFile(
          subtitleFile,
          this.subtitleFilesRepository,
          { audioFile: audioEntity },
          "done"
        );

        // Save subtitle file with associated audio file entity

        // 如果音频文件存在，那么对应的视频文件状态也应该是 'done'
        const videoFileIndex = videoFiles.findIndex(
          (filePath) =>
            path.basename(filePath, path.extname(filePath)) ===
            path.basename(audioFile, path.extname(audioFile))
        );
        if (videoFileIndex !== -1) {
          const videoFile = videoFiles[videoFileIndex];
          const videoEntity = await this.saveOrUpdateFile(
            videoFile,
            this.videoFilesRepository,
            {},
            "done"
          );

          // Update audio file with associated video file entity
          audioEntity.videoFile = videoEntity;
          await this.audioFilesRepository.save(audioEntity);

          videoFiles = [
            ...videoFiles.slice(0, videoFileIndex),
            ...videoFiles.slice(videoFileIndex + 1),
          ];
        }

        audioFiles = [
          ...audioFiles.slice(0, audioFileIndex),
          ...audioFiles.slice(audioFileIndex + 1),
        ];
      }
    }

    // 遍历音频文件,要查找对应的 subtitleFilesRepository 实体关系，并且找到把它们关联起来，status改为done
    for (const audioFile of audioFiles) {
      // 查找对应的字幕文件

      // todo: 改成where函数
      const subtitleEntity = await this.subtitleFilesRepository.findOne({
        where: {
          baseName: path.basename(audioFile, path.extname(audioFile)),
        },
      });

      // 如果找到字幕文件，把它们关联起来并设置状态为 'done'

      const audioEntity = await this.saveOrUpdateFile(
        audioFile,
        this.audioFilesRepository
      );
      if (subtitleEntity) {
        await this.saveOrUpdateFile(
          subtitleEntity.filePath,
          this.subtitleFilesRepository,
          { audioFile: audioEntity }, // 关联的字幕文件
          "done"
        );
      }
    }

    // 遍历视频文件,要查找对应的 audioFilesRepository 实体关系，并且找到把它们关联起来，status改为done
    for (const videoFile of videoFiles) {
      // 查找对应的音频文件
      const audioEntity = await this.audioFilesRepository.findOne({
        where: {
          baseName: path.basename(videoFile, path.extname(videoFile)),
        },
      });
      const videoEntity = await this.saveOrUpdateFile(
        videoFile,
        this.videoFilesRepository
      );
      if (audioEntity) {
        // 如果找到音频文件，把它们关联起来并设置状态为 'done'
        await this.saveOrUpdateFile(
          audioEntity.filePath,
          this.audioFilesRepository,
          { videoFile: videoEntity }, // 关联的音频文件
          "done"
        );
      }
    }
  }

  async addFileToDB(filePaths: string[]) {
    let videoFiles = [],
      audioFiles = [],
      subtitleFiles = [];

    filePaths.forEach((filePath) => {
      const fileName = basename(filePath);
      // console.log(`File ${filePath} has been added, ${fileName}`);
      const ext = path.extname(filePath).slice(1);

      // 当发现新文件，执行保存到数据库的操作
      // 检查文件扩展名并分类
      if (this.videoExtensions.includes(ext)) {
        videoFiles.push(filePath);
      } else if (this.audioExtensions.includes(ext)) {
        audioFiles.push(filePath);
      } else if (this.subtitleExtensions.includes(ext)) {
        subtitleFiles.push(filePath);
      }
    });
    await this.saveFilesToDB({
      videoFiles,
      audioFiles,
      subtitleFiles,
    });
  }

  private watchFiles(): void {
    const watcher = chokidar.watch(this.videoDir, {
      ignored: /^\./, // ignore dotfiles
      persistent: true,
    });

    watcher.on("add", async (filePath, stats) => {
      if (this.isInitializing) {
        return;
      }

      await this.addFileToDB([filePath]);
      if (this.checkNfoFile(filePath)) {
        this.updateVideoImage(filePath);
      }
    });
  }

  checkNfoFile(filePath: string) {
    const nfoFile = path.join(
      path.dirname(filePath),
      path.basename(filePath, path.extname(filePath)) + ".nfo"
    );
    return fs.existsSync(nfoFile);
  }

  getNfoImage(filePath: string) {
    const nfoFile = path.join(
      path.dirname(filePath),
      path.basename(filePath, path.extname(filePath)) + ".nfo"
    );
    const nfo = fs.readFileSync(nfoFile, "utf-8");
    const $ = cheerio.load(nfo);
    const poster = $("poster").text();
    const fanart = $("fanart").text();

    const exist = (filePath) => {
      return fs.existsSync(filePath);
    };

    const resultPath = (filePath) => {
      if (exist(filePath)) {
        return filePath;
      } else if (
        exist(path.join(path.dirname(nfoFile), path.basename(filePath)))
      ) {
        return path.join(path.dirname(nfoFile), path.basename(filePath));
      } else {
        return null;
      }
    };

    return {
      poster: poster ? resultPath(poster) : null,
      fanart: fanart ? resultPath(fanart) : null,
    };
  }

  async updateVideoImage(filePath: string) {
    const { poster, fanart } = this.getNfoImage(filePath);

    const result = await this.videoFilesRepository.update(
      { filePath },
      { poster, fanart }
    );

    return result;
  }

  async findAndClassifyFilesWithDir(): Promise<VideoDirFileGroup[]> {
    const groupedFiles = [];

    try {
      const videoFiles = await fg.stream(
        path.join(
          this.videoDir,
          "**/*.{" + this.videoExtensions.join(",") + "}"
        ),
        { dot: true }
      );

      for await (const videoFile of videoFiles) {
        let videoFileStr: string;

        if (Buffer.isBuffer(videoFile)) {
          videoFileStr = videoFile.toString();
        } else {
          videoFileStr = videoFile;
        }
        const directory = path.dirname(videoFileStr);
        const baseName = path
          .basename(videoFileStr, path.extname(videoFileStr))
          .replace(/'/g, "\\'");

        // 查找同一目录下的音频文件和字幕文件
        const audioFilesPromise = fg.async(
          path.join(
            directory,
            baseName + ".{" + this.audioExtensions.join(",") + "}"
          )
        );

        const subtitleFilesPromise = fg.async(
          path.join(
            directory,
            `${baseName}*.{${this.subtitleExtensions.join(",")}}`
          )
        );

        const [audioFiles, subtitleFiles] = await Promise.all([
          audioFilesPromise,
          subtitleFilesPromise,
        ]);

        fg.globSync(
          path.join(
            directory,
            baseName + ".{" + this.audioExtensions.join(",") + "}"
          )
        );

        groupedFiles.push({
          videoFile,
          audioFiles,
          subtitleFiles,
        });
      }
    } catch (error) {
      console.error("Error during file classification:", error);
      // Handle the error appropriately
    }

    return groupedFiles;
  }

  async saveVideoFileGroup(videoFileGroup: VideoDirFileGroup) {
    const { videoFile, audioFiles, subtitleFiles } = videoFileGroup;

    const videoFilePath = videoFile.toString();
    const videoFileName = path.basename(videoFilePath);
    const videoBaseName = path.basename(
      videoFilePath,
      path.extname(videoFilePath)
    );
    const videoExtName = path.extname(videoFilePath);

    let videoFileEntity = await this.videoFilesRepository.findOne({
      where: { fileName: videoFileName },
    });

    if (videoFileEntity) {
      videoFileEntity.status = "done";
      await this.videoFilesRepository.save(videoFileEntity);
    } else {
      const newVideoFileEntity = this.videoFilesRepository.create({
        filePath: videoFilePath,
        fileName: videoFileName,
        baseName: videoBaseName,
        extName: videoExtName,
        status: "done",
      });
      videoFileEntity =
        await this.videoFilesRepository.save(newVideoFileEntity);
    }

    // 假定每个视频文件只有一个音频文件
    let audioFileEntity: AudioFileEntity;
    for (const audioFile of audioFiles) {
      const audioFilePath = audioFile.toString();
      const audioFileName = path.basename(audioFilePath);
      const audioBaseName = path.basename(
        audioFilePath,
        path.extname(audioFilePath)
      );
      const audioExtName = path.extname(audioFilePath);

      audioFileEntity = await this.audioFilesRepository.findOne({
        where: { fileName: audioFileName },
      });

      if (audioFileEntity) {
        audioFileEntity.status = "done";
        audioFileEntity.videoFile = videoFileEntity;
        await this.audioFilesRepository.save(audioFileEntity);
      } else {
        const newAudioFileEntity = this.audioFilesRepository.create({
          filePath: audioFilePath,
          fileName: audioFileName,
          baseName: audioBaseName,
          extName: audioExtName,
          status: "done",
          videoFile: videoFileEntity,
        });
        audioFileEntity =
          await this.audioFilesRepository.save(newAudioFileEntity);
      }
    }

    for (const subtitleFile of subtitleFiles) {
      const subtitleFilePath = subtitleFile.toString();
      const subtitle = path.basename(subtitleFilePath);
      const subtitleBaseName = path.basename(
        subtitleFilePath,
        path.extname(subtitleFilePath)
      );
      const subtitleExtName = path.extname(subtitleFilePath);

      const subtitleFileEntity = await this.subtitleFilesRepository.findOne({
        where: { fileName: subtitle },
      });

      if (subtitleFileEntity) {
        subtitleFileEntity.status = "done";
        subtitleFileEntity.audioFile = audioFileEntity;
        subtitleFileEntity.videoFile = videoFileEntity;

        await this.subtitleFilesRepository.save(subtitleFileEntity);
      } else {
        const newSubtitleFileEntity = this.subtitleFilesRepository.create({
          filePath: subtitleFilePath,
          fileName: subtitle,
          baseName: subtitleBaseName,
          extName: subtitleExtName,
          status: "done",
          audioFile: audioFileEntity,
          videoFile: videoFileEntity,
        });
        await this.subtitleFilesRepository.save(newSubtitleFileEntity);
      }
    }
  }

  create(createWatchDto: CreateWatchDto) {
    return "This action adds a new watch";
  }

  findAll() {
    return `This action returns all watch`;
  }

  findOne(id: number) {
    return `This action returns a #${id} watch`;
  }

  update(id: number, updateWatchDto: UpdateWatchDto) {
    return `This action updates a #${id} watch`;
  }

  remove(id: number) {
    return `This action removes a #${id} watch`;
  }
}
