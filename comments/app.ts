import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  ScanCommand,
  DeleteCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { SQSEvent } from 'aws-lambda';

// Zod schemas
const CommentSchema = z.object({
  id: z.string(),
  content: z.string().min(1, '评论内容不能为空').max(1000, '评论内容不能超过1000个字符'),
  author: z.string().min(1, '作者名不能为空').max(50, '作者名不能超过50个字符'),
  userId: z.string(),
  email: z.string().email(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const CreateCommentSchema = z.object({
  content: z.string().min(1, '评论内容不能为空').max(1000, '评论内容不能超过1000个字符'),
});

const UpdateCommentSchema = z
  .object({
    content: z
      .string()
      .min(1, '评论内容不能为空')
      .max(1000, '评论内容不能超过1000个字符')
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: '至少需要更新一个字段',
  });

// Types from Zod schemas
type Comment = z.infer<typeof CommentSchema>;
type CreateCommentInput = z.infer<typeof CreateCommentSchema>;
type UpdateCommentInput = z.infer<typeof UpdateCommentSchema>;

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);
const tableName = process.env.TABLE_NAME || 'CommentsTable';

const sqs = new SQSClient({ region: process.env.AWS_REGION });

// 从认证上下文中获取用户信息
const getUserFromEvent = (event: APIGatewayProxyEvent) => {
  const claims = event.requestContext.authorizer?.claims;
  if (!claims) {
    throw new Error('未找到用户信息');
  }
  return {
    userId: claims.sub as string,
    email: claims.email as string,
  };
};

/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 *
 */

export const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const { httpMethod, body, pathParameters } = event;
    let response;

    switch (httpMethod) {
      case 'GET':
        if (pathParameters?.id) {
          response = await getItem(pathParameters.id);
        } else {
          response = await listItems();
        }
        break;
      case 'POST':
        const user = getUserFromEvent(event);
        const createInput = CreateCommentSchema.parse(JSON.parse(body || '{}'));
        response = await createItem(createInput, user);
        break;
      case 'PUT':
        const updateUser = getUserFromEvent(event);
        const updateInput = UpdateCommentSchema.parse(JSON.parse(body || '{}'));
        response = await updateItem(pathParameters?.id, updateInput, updateUser);
        break;
      case 'DELETE':
        response = await deleteComment(event);
        break;
      default:
        response = {
          statusCode: 405,
          body: JSON.stringify({ message: 'Method Not Allowed' }),
        };
    }

    return response;
  } catch (err) {
    console.log(err);
    if (err instanceof z.ZodError) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: '输入验证失败',
          errors: err.errors,
        }),
      };
    }
    if (err instanceof Error) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          message: err.message,
        }),
      };
    }
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Internal Server Error',
      }),
    };
  }
};

const getItem = async (id: string | undefined): Promise<APIGatewayProxyResult> => {
  if (!id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'ID is required' }),
    };
  }

  const params = {
    TableName: tableName,
    Key: { id },
  };

  const { Item } = await ddbDocClient.send(new GetCommand(params));

  if (!Item) {
    return {
      statusCode: 404,
      body: JSON.stringify({ message: '评论不存在' }),
    };
  }

  const comment = CommentSchema.parse(Item);
  return {
    statusCode: 200,
    body: JSON.stringify(comment),
  };
};

const createItem = async (
  input: CreateCommentInput,
  user: { userId: string; email: string }
): Promise<APIGatewayProxyResult> => {
  try {
    // 发送创建请求到 SQS
    await sqs.send(new SendMessageCommand({
      QueueUrl: process.env.CREATE_QUEUE_URL,
      MessageBody: JSON.stringify({
        content: input.content,
        userId: user.userId,
        email: user.email,
      }),
    }));

    return {
      statusCode: 202,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Create request accepted",
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Internal server error",
      }),
    };
  }
};

const updateItem = async (
  id: string | undefined,
  input: UpdateCommentInput,
  user: { userId: string; email: string }
): Promise<APIGatewayProxyResult> => {
  if (!id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'ID is required' }),
    };
  }

  // 首先检查项目是否存在
  const getParams = {
    TableName: tableName,
    Key: { id },
  };

  const { Item } = await ddbDocClient.send(new GetCommand(getParams));

  if (!Item) {
    return {
      statusCode: 404,
      body: JSON.stringify({ message: '评论不存在' }),
    };
  }

  // 检查是否是评论作者
  if (Item.userId !== user.userId) {
    return {
      statusCode: 403,
      body: JSON.stringify({ message: '只有评论作者才能修改评论' }),
    };
  }

  const updateExpressions: string[] = [];
  const expressionAttributeNames: { [key: string]: string } = {};
  const expressionAttributeValues: { [key: string]: string | undefined } = {};

  // 添加更新时间
  updateExpressions.push('#updatedAt = :updatedAt');
  expressionAttributeNames['#updatedAt'] = 'updatedAt';
  expressionAttributeValues[':updatedAt'] = new Date().toISOString();

  // 处理可选字段
  if (input.content !== undefined) {
    updateExpressions.push('#content = :content');
    expressionAttributeNames['#content'] = 'content';
    expressionAttributeValues[':content'] = input.content;
  }

  const params = {
    TableName: tableName,
    Key: { id },
    UpdateExpression: `set ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_NEW' as const,
  };

  const { Attributes } = await ddbDocClient.send(new UpdateCommand(params));
  const updatedComment = CommentSchema.parse(Attributes);

  return {
    statusCode: 200,
    body: JSON.stringify(updatedComment),
  };
};

const deleteComment = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const commentId = event.pathParameters?.id;
    if (!commentId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Comment ID is required",
        }),
      };
    }

    const authorizer = event.requestContext.authorizer;
    if (!authorizer || !authorizer.claims || !authorizer.claims.sub) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          message: "Unauthorized",
        }),
      };
    }

    // 首先检查评论是否存在
    const getParams = {
      TableName: tableName,
      Key: { id: commentId },
    };

    const { Item } = await ddbDocClient.send(new GetCommand(getParams));

    if (!Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: '评论不存在' }),
      };
    }

    // 检查是否是评论作者
    if (Item.userId !== authorizer.claims.sub) {
      return {
        statusCode: 403,
        body: JSON.stringify({ message: '只有评论作者才能删除评论' }),
      };
    }

    // 执行删除操作
    const deleteParams = {
      TableName: tableName,
      Key: { id: commentId },
    };

    await ddbDocClient.send(new DeleteCommand(deleteParams));

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Comment deleted successfully",
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Internal server error",
      }),
    };
  }
};

const listItems = async (): Promise<APIGatewayProxyResult> => {
  const params = {
    TableName: tableName,
  };

  const { Items } = await ddbDocClient.send(new ScanCommand(params));

  if (!Items) {
    return {
      statusCode: 200,
      body: JSON.stringify([]),
    };
  }

  try {
    const comments = Items.map(item => ({
      id: item.id,
      content: item.content,
      author: item.author,
      userId: item.userId || '',  // 为旧数据提供默认值
      email: item.email || '',    // 为旧数据提供默认值
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
    return {
      statusCode: 200,
      body: JSON.stringify(comments),
    };
  } catch (err) {
    console.error('Error parsing comments:', err);
    return {
      statusCode: 200,
      body: JSON.stringify([]),
    };
  }
};

// Add SQS handler
export const sqsCreateCommentHandler = async (event: SQSEvent) => {
  try {
    for (const record of event.Records) {
      const { content, userId, email } = JSON.parse(record.body);

      const timestamp = new Date().toISOString();
      const item = {
        id: Date.now().toString(),
        content,
        author: email.split('@')[0],
        userId,
        email,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      // 验证数据
      CommentSchema.parse(item);

      // 保存到 DynamoDB
      const params = {
        TableName: tableName,
        Item: item,
      };

      await ddbDocClient.send(new PutCommand(params));
      console.log(`Successfully created comment ${item.id}`);
    }
  } catch (err) {
    console.error('Error processing create requests:', err);
    throw err;
  }
};
